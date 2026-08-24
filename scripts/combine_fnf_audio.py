#!/usr/bin/env python3
"""Combine FNF instrumental and vocal tracks into one OGG file using FFmpeg."""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Mix Inst.ogg and Vocals.ogg into a RYOKO-ready song.ogg."
    )
    parser.add_argument("instrumental", nargs="?", default="Inst.ogg", type=Path)
    parser.add_argument("vocals", nargs="?", default="Vocals.ogg", type=Path)
    parser.add_argument("output", nargs="?", default="song.ogg", type=Path)
    parser.add_argument(
        "--quality",
        type=float,
        default=6,
        metavar="Q",
        help="Vorbis quality from -1 to 10 (default: 6).",
    )
    parser.add_argument("--force", action="store_true", help="Overwrite the output file.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        print("Error: ffmpeg was not found in PATH.", file=sys.stderr)
        return 1

    missing = [path for path in (args.instrumental, args.vocals) if not path.is_file()]
    if missing:
        print(f"Error: missing input file(s): {', '.join(map(str, missing))}", file=sys.stderr)
        return 1
    if not -1 <= args.quality <= 10:
        print("Error: --quality must be between -1 and 10.", file=sys.stderr)
        return 1
    if args.output.exists() and not args.force:
        print(f"Error: {args.output} already exists. Use --force to overwrite it.", file=sys.stderr)
        return 1

    args.output.parent.mkdir(parents=True, exist_ok=True)
    command = [
        ffmpeg,
        "-hide_banner",
        "-y" if args.force else "-n",
        "-i",
        str(args.instrumental),
        "-i",
        str(args.vocals),
        "-filter_complex",
        "[0:a][1:a]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.98[a]",
        "-map",
        "[a]",
        "-c:a",
        "libvorbis",
        "-q:a",
        str(args.quality),
        str(args.output),
    ]

    print(f"Mixing {args.instrumental} + {args.vocals} -> {args.output}")
    try:
        subprocess.run(command, check=True)
    except subprocess.CalledProcessError as error:
        print(f"Error: FFmpeg exited with code {error.returncode}.", file=sys.stderr)
        return error.returncode or 1

    print(f"Created {args.output.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
