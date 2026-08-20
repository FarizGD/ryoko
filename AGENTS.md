# RYŌKO / 凌鼓 — Agent Context

## Project intent

RYŌKO is an experimental rhythm game prototype intended for Android and PC. The HTML5 version is a gameplay and tooling prototype; the planned production version will move to Godot later.

The core design goal is to combine the immediacy and replayability of games such as Geometry Dash, osu!, Friday Night Funkin', Project SEKAI, Sonolus, and STRINOVA without becoming a clone of any of them.

The current signature mechanic is directional rhythm movement: the player responds to timed inputs using taps, swipes, holds, and directional movement. Swiping/movement should feel like the game's identity rather than merely another note type.

## Current priorities

1. Make the HTML5 prototype genuinely playable and responsive.
2. Fix and improve the in-game chart editor.
3. Support local song loading for charting/testing.
4. Render incoming notes clearly and synchronize them to audio.
5. Keep chart data portable so the eventual Godot version can load the same JSON format.
6. Prioritize gameplay feel and timing accuracy over menus, cosmetics, accounts, or other polish.

## Deployment / development

- Repository: `FarizGD/ryoko`
- Current prototype branch: `prototype/html5-foundation`
- Public GitHub Pages build may be available at `https://farizgd.github.io/ryoko` depending on Pages branch configuration.
- Local development is preferred for debugging. The user runs an Apache server locally, so the project should work correctly over ordinary HTTP rather than relying on `file://` behavior.
- Avoid requiring a Node/Vite build step unless there is a strong reason. Plain HTML/CSS/ES modules are preferred for the prototype.

## Architecture principles

Keep systems separated enough that the concepts can be reimplemented cleanly in Godot later:

- input layer
- rhythm/audio clock
- chart model / serialization
- gameplay judging
- renderer
- chart editor

Do not tightly couple chart timestamps to frame movement. Rhythm judgment must be based on an audio-derived clock or synchronized playback position, not frame count.

## Chart format

Use engine-independent JSON. Current conceptual shape:

```json
{
  "version": 1,
  "song": {
    "title": "Example",
    "artist": "Unknown",
    "bpm": 150,
    "offset": 0
  },
  "notes": [
    {
      "time": 1000,
      "type": "swipe",
      "direction": "up"
    }
  ]
}
```

Times are currently expressed in milliseconds unless the existing code says otherwise. Preserve backwards compatibility when practical.

Potential note types:

- `tap`
- `swipe`
- `hold`
- future special/gimmick notes

Directions:

- `up`
- `right`
- `down`
- `left`

The eventual Godot version should be able to consume the same conceptual chart data with minimal conversion.

## Input targets

### PC

- Arrow keys
- WASD where appropriate
- mouse drag/swipe for testing
- controller support later

### Mobile

- touch gestures
- directional swipes
- taps and holds

Input should be normalized into game actions before judgment so charts are device-independent.

## Chart editor goals

The editor is part of the product pipeline, not throwaway tooling.

Required / desired features:

- load a local song file
- play / pause
- timeline scrubbing
- BPM editing
- song offset editing
- beat snapping, including subdivisions such as 1/4, 1/8, 1/16
- place notes on the timeline
- choose note type and direction
- select notes
- drag notes to move them
- delete notes
- copy/paste later
- undo/redo later
- import/export chart JSON
- test gameplay from the current timeline position
- future record mode: play directional inputs live while the editor records and quantizes them

When loading songs in the browser, local file input + object URLs is acceptable for development. Do not assume songs should be committed to the repository, especially copyrighted music.

## Known history / bugs

Earlier prototype issues included:

- rhythm clock `position` not advancing while running
- code disagreement between `clock.position` and `clock.current`
- editor CSS selectors not matching HTML IDs/classes
- chart editor playback/playhead issues
- local song loading still reported by the user as not working reliably

Do not assume these are fully solved. Reproduce locally and inspect browser console errors before redesigning unrelated systems.

## Immediate next engineering work

When continuing development, strongly prefer this order:

1. Inspect the current branch and run it locally through HTTP.
2. Reproduce local song loading failure.
3. Make audio playback the authoritative timeline clock.
4. Ensure game and editor transport controls operate on the same audio timeline.
5. Fix chart editor placement, selection, dragging, scrubbing, and snapping.
6. Add visible incoming directional notes in gameplay.
7. Tune timing windows and movement feel only after audio synchronization is trustworthy.

## Gameplay direction

The original concept is broader than a static lane rhythm game.

Possible future ideas:

- directional movement through the music
- momentum / sharp turns
- platforming or movement sections inspired by rhythm-platformer gameplay
- world/environment reactions synchronized to music
- boss attacks / counter sequences
- gravity, mirror, glitch, speed, echo, and other chart gimmicks
- character abilities much later

Do not implement all of these at once. Prototype one mechanic at a time and keep only what feels fun.

## Naming / branding

Working title: **RYŌKO / 凌鼓**.

The intended coined kanji concept is roughly "surpass the beat" / "overcome the drumbeat" rather than an established Japanese word. Treat this as project branding, not as a linguistics claim.

Do not rename the project unless the user explicitly asks.

## Coding preferences

- Keep the prototype simple and readable.
- Prefer small ES modules over one giant file.
- Avoid unnecessary dependencies.
- Avoid build tooling unless it materially improves the project.
- Preserve mobile compatibility.
- Use responsive layouts and touch-safe controls.
- Test under Apache / normal HTTP.
- Do not commit third-party copyrighted songs.
- Favor measurable timing correctness over visual effects.

## Collaboration behavior

When making changes:

- inspect existing code before replacing systems wholesale
- explain meaningful architecture changes concisely
- fix reproducible bugs before adding unrelated features
- avoid fake completion claims; verify behavior when possible
- preserve the MIT license
- keep Godot migration in mind, but do not prematurely rewrite the HTML prototype as if it were Godot
