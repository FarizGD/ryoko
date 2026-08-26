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

The chart editor supports local audio, JSON import/export, timeline seeking, beat snapping, zoom, FNF-style eight-lane placement, and note dragging.

## osu!mania conversion

Convert every mania difficulty in an `.osz` into one multi-chart package:

```bash
python scripts/convert_osz_mania.py song.osz charts/song.ryoko
```

Use `--modchart custom.js` to embed an existing RYŌKO modchart, or `--generate-modchart` to generate basic beat zoom and osu! break effects. Full osu storyboard animation conversion is not supported.

## Architecture

Phaser owns gameplay rendering and animation. Audio remains the authoritative rhythm clock, while chart data, judging, input, and editor logic stay in separate ES modules. Charts remain engine-independent JSON.

## License

MIT — see [LICENSE.md](LICENSE.md).
