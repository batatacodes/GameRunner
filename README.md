```md
# Endless Runner 3D (React + Three.js)

Protótipo de "Endless Runner" 3D feito com React, Three.js, HTML e CSS.

Principais características
- Jogador controla um cubo que corre para frente automaticamente.
- Três faixas laterais: esquerda, centro e direita (troque de faixa com teclado, botões ou swipe).
- Pista gerada em seções; seção anterior faz fade-out e é removida.
- Obstáculos aleatórios (solo e agrupados).
- Velocidade aumenta progressivamente.
- Ao colidir, o jogo para e exibe modal para reiniciar.
- Leve e otimizado para mobile/PC (geometrias simples, sem texturas pesadas).

Como rodar
1. Node 16+ recomendado.
2. Instale dependências:
   npm install
3. Rode em desenvolvimento:
   npm start
4. Abra http://localhost:1234 (o Parcel geralmente abre automaticamente).

Arquivos principais
- src/Game.jsx — lógica do jogo (Three.js + geração procedural).
- src/App.jsx — wrapper React e UI (modal, botões).
- src/styles.css — estilos e responsividade.

Notas de implementação
- Colisões básicas usando Box3 (bounding boxes).
- Seções são objetos com material transparente que fazem fade-out.
- Controles: setas/A/D para mover, ou toque (swipe) no mobile. Botões laterais também disponíveis.
- Para performance, mantive baixa resolução de geometria e evitei sombras pesadas.
