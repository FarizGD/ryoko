modchart.onBeat = (api, state) => {
  api.camera.zoom(state.beat % 4 === 0 ? 0.08 : 0.035, 120);
};
