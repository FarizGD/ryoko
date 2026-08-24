// Monochrome example modchart. See docs/MODCHARTS.md for the complete API.
modchart.onStart = api => {
  api.scene.background('#0d0c18');
  api.scene.message('MONOCHROME MODCHART', 1200);
};

modchart.onBeat = (api, state) => {
  const side = state.beat % 2 === 0 ? -1 : 1;
  api.camera.rotate(side * 0.7, 105);
  api.receptors.scale(state.beat % 4 === 0 ? 1.12 : 1.06, 100);
};

modchart.onHit = (api, state, hit) => {
  if (hit.judgment === 'PERFECT' && state.combo % 25 === 0) {
    api.scene.flash('#8f7cff', 0.12, 180);
    api.player.scale(1.35, 120);
  }
};

modchart.onEvent = (api, state, event) => {
  if (event.name === 'Change Scroll Speed') api.scene.message('SPEED SHIFT', 900);
};
