# RYŌKO / 凌鼓

HTML5 prototype for an original cross-platform rhythm game centered around directional movement and swiping.

> **Concept:** surpass the beat.

## Prototype

- Keyboard: Arrow keys or WASD
- Mobile: swipe in any direction
- Mouse: drag/swipe in the play area
- Timing judgments: Perfect / Great / Good / Miss
- Combo, score and health
- In-game chart editor
- JSON chart import/export
- Beat/BPM-based timing architecture intended to migrate to Godot later

## Run

Serve the repository with any static web server because the game uses ES modules. For example:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Current limitations

This is an early gameplay prototype. Audio playback, real note rendering, advanced holds, chart quantization, and polished effects are planned for later iterations.

## Project direction

The HTML5 version is being used to validate the gameplay loop and chart workflow before the production implementation in Godot.

## License

MIT — see [LICENSE](LICENSE).
