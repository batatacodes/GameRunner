import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";

/*
  Endless Runner 3D
  - Player is a cube that moves forward automatically.
  - Three lanes: left, center, right.
  - Sections are generated ahead; previous section fades out and is removed.
  - Obstacles spawn randomly (ground and grouped).
  - Speed increases progressively.
  - On collision, show modal to restart.
  - Controls: Arrow keys / A D / On-screen buttons / Swipe
*/

const LANE_X = [-2.2, 0, 2.2];
const SECTION_LENGTH = 30;
const VISIBLE_SECTIONS = 4; // how many ahead to keep
const OBSTACLE_PROB = 0.28; // chance to spawn obstacle per lane per section
const GROUP_PROB = 0.12; // chance to spawn a grouped obstacle cluster
const BASE_SPEED = 8; // units per second
const SPEED_UP_RATE = 0.0009; // incremental speed per frame time (will be scaled by dt)
const PLAYER_LERP = 0.18; // lateral smoothing

export default function Game(){
  const containerRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const playerRef = useRef(null);
  const sectionsRef = useRef([]); // active sections
  const fadingRef = useRef([]); // sections fading out
  const obstaclesRef = useRef([]);
  const animRef = useRef(null);
  const lastTimeRef = useRef(null);
  const speedRef = useRef(BASE_SPEED);
  const distanceRef = useRef(0);
  const [gameOver, setGameOver] = useState(false);
  const [score, setScore] = useState(0);
  const inputRef = useRef({ left:false, right:false });
  const targetLaneRef = useRef(1); // start center index 1
  const touchDataRef = useRef({ startX: null, startY: null, startTime: 0 });

  useEffect(() => {
    init();
    return () => cleanup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function init(){
    // Basic three setup
    const width = containerRef.current.clientWidth || window.innerWidth;
    const height = containerRef.current.clientHeight || window.innerHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x081827);
    scene.fog = new THREE.Fog(0x081827, 20, 280);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(60, width/height, 0.1, 1000);
    camera.position.set(0, 6, -10);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = false; // mobile-friendly
    renderer.domElement.style.display = "block";
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // lights — simple and cheap
    const hemi = new THREE.HemisphereLight(0xffffff, 0x080820, 0.8);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 0.6);
    dir.position.set(5, 10, -5);
    scene.add(dir);

    // player (cube)
    const playerGeom = new THREE.BoxGeometry(1.2, 1.2, 1.2);
    const playerMat = new THREE.MeshStandardMaterial({ color: 0xffa84d, roughness: 0.6, metalness: 0.1 });
    const playerMesh = new THREE.Mesh(playerGeom, playerMat);
    playerMesh.position.set(LANE_X[1], 1.0, 0); // start at z=0
    scene.add(playerMesh);
    playerRef.current = { mesh: playerMesh, bbox: new THREE.Box3() };

    // ground & initial sections
    sectionsRef.current = [];
    fadingRef.current = [];
    obstaclesRef.current = [];
    speedRef.current = BASE_SPEED;
    distanceRef.current = 0;
    lastTimeRef.current = performance.now();
    targetLaneRef.current = 1;
    setGameOver(false);
    setScore(0);

    // create an initial set of sections behind and ahead
    let zStart = -SECTION_LENGTH; // start section behind player so there is some room
    for(let i=0;i<VISIBLE_SECTIONS;i++){
      spawnSection(zStart);
      zStart += SECTION_LENGTH;
    }

    // camera initial follow
    camera.position.set(0, 5.2, -8);
    camera.lookAt(playerMesh.position);

    // event listeners
    window.addEventListener("resize", onResize, { passive:true });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    // touch events for swipe
    renderer.domElement.addEventListener("touchstart", onTouchStart, { passive:true });
    renderer.domElement.addEventListener("touchend", onTouchEnd, { passive:true });

    // start loop
    animRef.current = requestAnimationFrame(loop);
  }

  function cleanup(){
    cancelAnimationFrame(animRef.current);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    if(rendererRef.current && rendererRef.current.domElement){
      rendererRef.current.domElement.removeEventListener("touchstart", onTouchStart);
      rendererRef.current.domElement.removeEventListener("touchend", onTouchEnd);
    }
    // dispose three objects
    const scene = sceneRef.current;
    if(scene){
      scene.traverse((o) => {
        if(o.geometry) o.geometry.dispose?.();
        if(o.material){
          if(Array.isArray(o.material)){
            o.material.forEach(m => m.dispose?.());
          } else {
            o.material.dispose?.();
          }
        }
      });
    }
    // remove canvas
    if(rendererRef.current && rendererRef.current.domElement && containerRef.current){
      containerRef.current.removeChild(rendererRef.current.domElement);
    }
    rendererRef.current = null;
    sceneRef.current = null;
    cameraRef.current = null;
    playerRef.current = null;
    sectionsRef.current = [];
    fadingRef.current = [];
    obstaclesRef.current = [];
  }

  function onResize(){
    const w = containerRef.current.clientWidth || window.innerWidth;
    const h = containerRef.current.clientHeight || window.innerHeight;
    const cam = cameraRef.current;
    const renderer = rendererRef.current;
    if(cam && renderer){
      cam.aspect = w/h;
      cam.updateProjectionMatrix();
      renderer.setSize(w,h);
    }
  }

  function onKeyDown(e){
    if(gameOver) return;
    if(e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
      moveLeft();
    } else if(e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
      moveRight();
    } else if(e.key === "ArrowUp" || e.key === "w" || e.key === "W") {
      // small speed burst
      speedRef.current += 2;
    }
  }
  function onKeyUp(){ /* reserved */ }

  function onTouchStart(e){
    const t = e.touches[0];
    touchDataRef.current.startX = t.clientX;
    touchDataRef.current.startY = t.clientY;
    touchDataRef.current.startTime = performance.now();
  }
  function onTouchEnd(e){
    const t = e.changedTouches[0];
    const dx = t.clientX - touchDataRef.current.startX;
    const dy = t.clientY - touchDataRef.current.startY;
    const dt = performance.now() - touchDataRef.current.startTime;
    // simple swipe detection
    if(dt < 500 && Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(dy)){
      if(dx < 0) moveLeft(); else moveRight();
    } else {
      // tap: if tap in left half, go left; right half go right
      const w = window.innerWidth;
      if(t.clientX < w*0.4) moveLeft();
      else if(t.clientX > w*0.6) moveRight();
    }
  }

  function moveLeft(){
    targetLaneRef.current = Math.max(0, targetLaneRef.current - 1);
  }
  function moveRight(){
    targetLaneRef.current = Math.min(2, targetLaneRef.current + 1);
  }

  function spawnSection(zStart){
    const scene = sceneRef.current;
    if(!scene) return;

    // ground piece (Box to allow fade-out)
    const geom = new THREE.BoxGeometry(8.5, 0.4, SECTION_LENGTH);
    const mat = new THREE.MeshStandardMaterial({ color: 0x112233, transparent: true, opacity: 1, roughness: 0.9 });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(0, 0, zStart + SECTION_LENGTH/2);
    mesh.receiveShadow = false;
    scene.add(mesh);

    // lane markers (visual thin planes)
    for(let i=0;i<3;i++){
      const markGeom = new THREE.PlaneGeometry(1.4, SECTION_LENGTH);
      const markMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent:true, opacity:0.06, side:THREE.DoubleSide });
      const pm = new THREE.Mesh(markGeom, markMat);
      pm.rotation.x = -Math.PI/2;
      pm.position.set(LANE_X[i], 0.201, zStart + SECTION_LENGTH/2);
      scene.add(pm);
    }

    // obstacles: every lane with some probability
    const obstacles = [];
    // potential z positions inside section
    const countPositions = 4 + Math.floor(Math.random()*3);
    for(let p=0;p<countPositions;p++){
      const localZ = zStart + 4 + p * (SECTION_LENGTH - 8) / Math.max(1, countPositions-1);
      // grouped cluster?
      if(Math.random() < GROUP_PROB){
        // spawn a small group occupying 1-2 lanes
        const groupSize = 1 + Math.floor(Math.random()*2);
        const startLane = Math.floor(Math.random()*(3 - groupSize + 1));
        for(let g=0; g<groupSize; g++){
          if(Math.random() < 0.9) {
            const lane = startLane + g;
            if(Math.random() < OBSTACLE_PROB){
              const obs = createObstacle(LANE_X[lane], localZ, 0.6 + Math.random()*1.2);
              scene.add(obs.mesh);
              obstacles.push(obs);
            }
          }
        }
      } else {
        for(let lane=0; lane<3; lane++){
          if(Math.random() < OBSTACLE_PROB){
            const obs = createObstacle(LANE_X[lane], localZ + (Math.random()-0.5)*1.6, 0.6 + Math.random()*1.4);
            scene.add(obs.mesh);
            obstacles.push(obs);
          }
        }
      }
    }

    const section = {
      mesh,
      mat,
      zStart,
      zEnd: zStart + SECTION_LENGTH,
      obstacles
    };
    sectionsRef.current.push(section);

    // ensure we keep only a few sections ahead
    while(sectionsRef.current.length > VISIBLE_SECTIONS + 2){
      const old = sectionsRef.current.shift();
      // start fade-out
      fadingRef.current.push({ section: old, fade: 1.0 });
    }
  }

  function createObstacle(x, z, size){
    const geom = new THREE.BoxGeometry(size, size, size);
    const mat = new THREE.MeshStandardMaterial({ color: 0x7a2b2b, roughness: 0.8 });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(x, size/2, z);
    const bbox = new THREE.Box3().setFromObject(mesh);
    return { mesh, bbox, size, mat };
  }

  function loop(now){
    animRef.current = requestAnimationFrame(loop);
    const last = lastTimeRef.current || now;
    const dt = Math.min(0.05, (now - last) / 1000);
    lastTimeRef.current = now;

    // increase speed slightly over time
    speedRef.current += SPEED_UP_RATE * dt * 1000; // scale
    const speed = speedRef.current;

    // move forward by increasing distance
    distanceRef.current += speed * dt;
    setScore(Math.floor(distanceRef.current));

    const player = playerRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const renderer = rendererRef.current;
    if(!player || !scene || !camera || !renderer) return;

    // move player forward in world space (we actually move sections backward by moving objects relative to player z)
    // For simplicity, we'll advance player.z forward positive
    player.mesh.position.z += speed * dt;

    // lateral movement — lerp to target lane
    const targetX = LANE_X[targetLaneRef.current];
    player.mesh.position.x = THREE.MathUtils.lerp(player.mesh.position.x, targetX, PLAYER_LERP);

    // camera follow smoothly
    const camTarget = new THREE.Vector3(player.mesh.position.x, player.mesh.position.y + 3.6, player.mesh.position.z - 8);
    camera.position.lerp(camTarget, 0.12);
    camera.lookAt(player.mesh.position.x, player.mesh.position.y + 0.4, player.mesh.position.z + 4);

    // spawn more sections if near end
    const lastSection = sectionsRef.current[sectionsRef.current.length - 1];
    if(lastSection && player.mesh.position.z > lastSection.zEnd - (SECTION_LENGTH * 1.5)){
      spawnSection(lastSection.zEnd);
    }

    // fade-out sections that are behind
    for(let i = fadingRef.current.length - 1; i >= 0; i--){
      const item = fadingRef.current[i];
      item.fade -= dt * 0.8; // fade speed
      const f = Math.max(0, item.fade);
      if(item.section.mat) item.section.mat.opacity = f;
      // fade obstacles' materials too (if present)
      item.section.obstacles.forEach(o => {
        if(o.mat) o.mat.opacity = f;
        if(o.mesh && o.mesh.material) o.mesh.material.transparent = true;
      });
      if(f <= 0){
        // remove from scene and cleanup
        try{
          scene.remove(item.section.mesh);
          item.section.obstacles.forEach(o => scene.remove(o.mesh));
        }catch(e){}
        fadingRef.current.splice(i,1);
      }
    }

    // collision detection (simple bbox intersection)
    playerRef.current.bbox.setFromObject(player.mesh);
    // update obstacle boxes
    for(const section of sectionsRef.current){
      for(const obs of section.obstacles){
        obs.bbox.setFromObject(obs.mesh);
        if(playerRef.current.bbox.intersectsBox(obs.bbox)){
          // collision!
          gameOverHandler();
          return;
        }
      }
    }
    // also check fading obstacles (just in case)
    for(const f of fadingRef.current){
      for(const obs of f.section.obstacles){
        obs.bbox.setFromObject(obs.mesh);
        if(playerRef.current.bbox.intersectsBox(obs.bbox)){
          gameOverHandler();
          return;
        }
      }
    }

    renderer.render(scene, camera);
  }

  function gameOverHandler(){
    if(gameOver) return;
    setGameOver(true);
    cancelAnimationFrame(animRef.current);
  }

  function restart(){
    // cleanup current scene and re-init
    cleanup();
    init();
  }

  // small UI and controls
  return (
    <div ref={containerRef} style={{width:'100%',height:'100%',position:'relative'}}>
      <div className="hud" aria-hidden>
        <div className="badge">Vel: {Math.round(speedRef.current * 10) / 10}</div>
        <div className="badge">Dist: {Math.floor(distanceRef.current)}</div>
      </div>

      <div className="top-right">
        <div className="small">Pistas geradas: {sectionsRef.current.length}</div>
      </div>

      <div className="controls" role="toolbar" aria-label="Controles">
        <div className="ctrl-btn" onPointerDown={() => moveLeft()}>⟵</div>
        <div className="ctrl-btn" onPointerDown={() => moveRight()}>⟶</div>
        <div className="ctrl-btn" onPointerDown={() => { speedRef.current += 3; }}>BOOST</div>
        <div className="ctrl-btn" onPointerDown={() => { targetLaneRef.current = 1; }}>CENTRO</div>
      </div>

      {gameOver && (
        <div className="modal-bg">
          <div className="modal" role="dialog" aria-modal="true">
            <h2>Você deseja jogar novamente?</h2>
            <p>Sua distância: <strong>{Math.floor(distanceRef.current)}</strong></p>
            <div style={{display:'flex',gap:12,justifyContent:'center',marginTop:10}}>
              <button onClick={() => { restart(); }} aria-label="Jogar novamente">Sim — Jogar novamente</button>
              <button onClick={() => { setGameOver(false); }} aria-label="Fechar">Fechar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}