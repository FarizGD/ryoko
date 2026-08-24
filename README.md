# RYŌKO / 凌鼓

Phaser prototype for an original cross-platform rhythm game centered around directional movement and swiping.

## Development

Requires a current Node.js release.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. Create a production build with `npm run build`; its output is written to `dist/` and can be served by Apache or any ordinary static HTTP server.

## Controls

- Arrow keys or WASD
- Direction buttons
- Touch or mouse swipe
- Space to play or pause

The chart editor supports local audio, JSON import/export, timeline seeking, beat snapping, zoom, double-click placement, and note dragging.

## Architecture

Phaser owns gameplay rendering and animation. Audio remains the authoritative rhythm clock, while chart data, judging, input, and editor logic stay in separate ES modules. Charts remain engine-independent JSON.

## License

MIT — see [LICENSE.md](LICENSE.md).
