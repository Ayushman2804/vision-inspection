"""Measure ONNX inference latency/throughput for README + resume metrics.

Usage:
    python benchmark.py --images data/neu-det/images/val --n 200
"""
import argparse
import statistics
import sys
import time
from pathlib import Path

import cv2

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "inference"))
from app.detector import Detector  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=str(Path(__file__).resolve().parents[1] / "inference/models/best.onnx"))
    ap.add_argument("--labels", default=str(Path(__file__).resolve().parents[1] / "inference/models/labels.json"))
    ap.add_argument("--images", required=True)
    ap.add_argument("--n", type=int, default=200)
    ap.add_argument("--cpu", action="store_true", help="force CPUExecutionProvider (matches Cloud Run / Render)")
    ap.add_argument("--threads", type=int, default=None,
                    help="ONNX Runtime intra/inter-op threads (default: ORT_THREADS, else 1; 1 matches Render free)")
    args = ap.parse_args()

    if not args.cpu:
        try:  # onnxruntime-gpu needs the CUDA/cuDNN DLLs; on Windows importing torch puts them on the path
            import torch  # noqa: F401
        except ImportError:
            pass
    det = Detector(args.model, args.labels, "bench", providers=["CPUExecutionProvider"] if args.cpu else None,
                   threads=args.threads)
    if not args.cpu and "CUDAExecutionProvider" not in det.session.get_providers():
        raise SystemExit("GPU run requested but CUDAExecutionProvider failed to load "
                         f"(got {det.session.get_providers()}). Use --cpu, or fix the CUDA/cuDNN install.")
    paths = sorted(p for p in Path(args.images).glob("*") if p.suffix.lower() in {".jpg", ".png", ".jpeg"})[: args.n]
    if not paths:
        raise SystemExit("No images found")

    for p in paths[:5]:  # warm-up
        det.predict(cv2.imread(str(p)))

    lat = []
    t0 = time.perf_counter()
    for p in paths:
        lat.append(det.predict(cv2.imread(str(p)))["latency_ms"])
    wall = time.perf_counter() - t0

    lat.sort()
    print(f"images: {len(paths)}  providers: {det.session.get_providers()}  ort threads: {det.threads}")
    print(f"latency ms  mean={statistics.mean(lat):.1f}  p50={lat[len(lat)//2]:.1f}  p95={lat[int(len(lat)*0.95)-1]:.1f}")
    print(f"throughput: {len(paths) / wall:.1f} images/sec (incl. image decode)")


if __name__ == "__main__":
    main()
