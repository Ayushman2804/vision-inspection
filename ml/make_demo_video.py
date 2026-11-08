"""Build a conveyor-belt style demo video from validation images.

The output is what the web "Live inspection" page plays and samples frames from.
Browsers need H.264, so re-encode the result with ffmpeg afterwards:

    python make_demo_video.py --images data/neu-det/images/val --out demo_raw.mp4
    ffmpeg -y -i demo_raw.mp4 -c:v libx264 -pix_fmt yuv420p -movflags +faststart ../frontend/public/sample.mp4
"""
import argparse
import random
from pathlib import Path

import cv2
import numpy as np


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--images", required=True)
    ap.add_argument("--out", default="demo_raw.mp4")
    ap.add_argument("--count", type=int, default=24, help="number of steel samples on the belt")
    ap.add_argument("--fps", type=int, default=25)
    ap.add_argument("--size", type=int, default=640)
    ap.add_argument("--hold", type=float, default=1.5, help="seconds each sample stays in view")
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    paths = [p for p in Path(args.images).glob("*") if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".bmp"}]
    random.Random(args.seed).shuffle(paths)
    paths = paths[: args.count]
    if len(paths) < 2:
        raise SystemExit("Need at least 2 images")

    s = args.size
    frames = [cv2.resize(cv2.imread(str(p)), (s, s), interpolation=cv2.INTER_CUBIC) for p in paths]
    writer = cv2.VideoWriter(args.out, cv2.VideoWriter_fourcc(*"mp4v"), args.fps, (s, s))
    hold_frames = int(args.hold * args.fps)
    slide_frames = 10

    for i, cur in enumerate(frames):
        for _ in range(hold_frames):
            writer.write(cur)
        nxt = frames[(i + 1) % len(frames)]
        for k in range(1, slide_frames + 1):  # belt slides the next sample in
            off = int(s * k / slide_frames)
            canvas = np.concatenate([cur, nxt], axis=1)[:, off : off + s]
            writer.write(canvas)
    writer.release()
    print(f"Wrote {args.out}. Now re-encode with ffmpeg (see docstring).")


if __name__ == "__main__":
    main()
