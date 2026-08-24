# RYŌKO song package (`.ryoko`)

A `.ryoko` file is a ZIP archive containing everything needed to load one song. Paths use forward slashes and `manifest.json` must be at the archive root.

## Version 1 layout

```text
manifest.json
charts/
  hard.json
audio/
  song.ogg
art/
  cover.png
  pause.png
```

Only `manifest.json`, one chart, and one audio file are required. Cover and pause artwork are optional.

## Manifest

```json
{
  "format": "ryoko-song-package",
  "version": 1,
  "song": {
    "title": "Example",
    "artist": "Unknown",
    "bpm": 160,
    "offset": 0,
    "scrollSpeed": 1,
    "audio": "audio/song.ogg",
    "cover": "art/cover.png",
    "pauseArt": "art/pause.png"
  },
  "defaultChart": "hard",
  "charts": [
    {
      "id": "hard",
      "name": "Hard",
      "file": "charts/hard.json",
      "format": "ryoko-v1"
    }
  ]
}
```

`charts` may contain multiple difficulties. Version 1 loads `defaultChart`, or the first chart when no matching default exists. Chart files may use native RYŌKO JSON or a supported FNF JSON shape; format detection is automatic on import.

Package files are opened entirely in the browser. Their audio and artwork are exposed through temporary object URLs and are not uploaded.
