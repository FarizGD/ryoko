# JavaScript modcharts

RYŌKO modcharts are optional JavaScript files that react to the audio-derived gameplay clock. They run in a Web Worker and send validated visual commands to Phaser. A modchart cannot directly manipulate the DOM or Phaser scene.

Package modcharts are executable code. Packages discovered from the project's own `./charts` directory are treated as trusted and run automatically. Manually uploaded packages require confirmation. Only add or enable modcharts from authors you trust.

## Package setup

Add a path to the selected chart entry in `manifest.json`:

```json
{
  "charts": [{
    "id": "hard",
    "file": "charts/hard.json",
    "format": "ryoko-v1",
    "modchart": "modcharts/hard.js"
  }]
}
```

The path must be relative to the archive root. Modcharts are limited to 1 MB.

If the manifest does not specify a path, RYŌKO automatically loads `modchart.js` from the archive root when present. Set `"modchart": false` on the selected chart to disable that fallback. The path can also be set at the manifest root or under `song`; a selected chart's value has highest priority.

## Hooks

Assign any of these functions to the provided `modchart` object:

```js
modchart.onLoad = (api, state) => {};
modchart.onStart = (api, state) => {};
modchart.onUpdate = (api, state) => {};
modchart.onBeat = (api, state) => {};
modchart.onHit = (api, state, hit) => {};
modchart.onMiss = (api, state, note) => {};
modchart.onEvent = (api, state, event) => {};
modchart.onReset = (api, state) => {};
```

`state` contains `time` (milliseconds), `beat`, `bpm`, `combo`, `health`, and `botplay`. Update callbacks are capped at approximately 30 calls per second. Never use frame counts for musical timing.

## Effects API

```js
api.camera.zoom(amount, durationMs);
api.camera.rotate(degrees, durationMs);
api.camera.shake(durationMs, intensity);
api.player.scale(amount, durationMs);
api.player.alpha(amount, durationMs);
api.receptors.rotate(degrees, durationMs);
api.receptors.scale(amount, durationMs);
api.scene.flash('#rrggbb', alpha, durationMs);
api.scene.background('#rrggbb', durationMs);
api.scene.message('Text', durationMs);
```

Values are clamped by the runtime to keep charts playable. Unknown commands are ignored. See `charts/monochrome/modchart.js` for a complete example.
