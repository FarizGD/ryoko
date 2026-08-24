# Example `.ryoko` source directory

This directory mirrors the contents of a `.ryoko` ZIP archive.

1. Add `audio/song.ogg`.
2. Edit metadata in `manifest.json`.
3. Add or edit charts under `charts/`.
4. Replace the example artwork if desired.
5. ZIP the **contents** of this directory so `manifest.json` is at the archive root.
6. Rename the resulting `.zip` file to `.ryoko`.

Do not ZIP the outer `ryoko-song` directory itself. The package loader expects `manifest.json` at the top level.
