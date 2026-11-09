"""Check that the deployed ONNX path (inference/app/detector.py) reproduces ultralytics' PyTorch detections.

detector.py reimplements letterboxing, decoding and NMS in NumPy, so it is a different code path from
the one that produced the validation mAP. This runs both on the same images with identical conf/iou and
compares detection counts, class labels and box corners.

Usage:
    python parity_check.py --weights runs/neu-det-v1/weights/best.pt --images data/neu-det/images/val
"""
import argparse
import sys
from pathlib import Path

import cv2
import numpy as np
from ultralytics import YOLO

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "inference"))
from app.detector import Detector  # noqa: E402


def iou(a, b):
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def match(ref, test):
    """Greedy same-class matching by IoU, highest-confidence reference boxes first.
    Returns (pairs, unmatched_ref, unmatched_test)."""
    used, pairs = set(), []
    for r in sorted(ref, key=lambda d: -d["conf"]):
        best, best_iou = None, 0.0
        for j, t in enumerate(test):
            if j in used or t["cls"] != r["cls"]:
                continue
            v = iou(r["box"], t["box"])
            if v > best_iou:
                best, best_iou = j, v
        if best is not None and best_iou > 0.5:
            used.add(best)
            pairs.append((r, test[best]))
    matched_ref = {id(r) for r, _ in pairs}
    return pairs, [r for r in ref if id(r) not in matched_ref], [t for j, t in enumerate(test) if j not in used]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", default="runs/neu-det-v1-26n/weights/best.pt")
    ap.add_argument("--onnx", default=str(ROOT / "inference/models/best.onnx"))
    ap.add_argument("--labels", default=str(ROOT / "inference/models/labels.json"))
    ap.add_argument("--images", default="data/neu-det/images/val")
    ap.add_argument("--n", type=int, default=20)
    ap.add_argument("--conf", type=float, default=0.25)
    ap.add_argument("--iou", type=float, default=0.7)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--px-tol", type=float, default=2.0, help="corner difference counted as OK")
    ap.add_argument("--max-bad-images", type=int, default=2, help="fail if more images than this mismatch")
    args = ap.parse_args()

    paths = sorted(p for p in Path(args.images).glob("*") if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".bmp"})
    if not paths:
        raise SystemExit("No images found")
    step = max(1, len(paths) // args.n)
    paths = paths[::step][: args.n]  # spread across all classes (files are sorted by class name)

    pt = YOLO(args.weights)
    onnx = Detector(args.onnx, args.labels, "parity")
    print(f"ONNX providers: {onnx.session.get_providers()}  conf={args.conf} iou={args.iou}\n")

    bad, worst_px, n_pairs = [], 0.0, 0
    print(f"{'image':<22}{'pt':>4}{'onnx':>6}  classes  {'max px':>7}  {'max dconf':>9}")
    for p in paths:
        img = cv2.imread(str(p))
        r = pt.predict(img, conf=args.conf, iou=args.iou, imgsz=args.imgsz, verbose=False)[0]
        ref = [{"cls": int(c), "conf": float(s), "box": b.tolist()}
               for b, c, s in zip(r.boxes.xyxy.cpu().numpy(), r.boxes.cls.cpu().numpy(), r.boxes.conf.cpu().numpy())]
        out = onnx.predict(img, conf=args.conf, iou=args.iou)["detections"]
        test = [{"cls": d["class_id"], "conf": d["confidence"], "box": d["bbox"]} for d in out]

        pairs, miss_ref, miss_test = match(ref, test)
        same_count = len(ref) == len(test)
        same_classes = sorted(d["cls"] for d in ref) == sorted(d["cls"] for d in test)
        px = max((float(np.abs(np.array(a["box"]) - np.array(b["box"])).max()) for a, b in pairs), default=0.0)
        dconf = max((abs(a["conf"] - b["conf"]) for a, b in pairs), default=0.0)
        worst_px, n_pairs = max(worst_px, px), n_pairs + len(pairs)

        ok = same_count and same_classes and not miss_ref and not miss_test and px <= args.px_tol
        flag = "" if ok else "  <-- MISMATCH"
        if not ok:
            bad.append(p.name)
        cls_txt = "same" if same_classes else "DIFF"
        print(f"{p.stem:<22}{len(ref):>4}{len(test):>6}  {cls_txt:<7}  {px:>7.2f}  {dconf:>9.4f}{flag}")
        for d in miss_ref:
            print(f"    only in PyTorch: {pt.names[d['cls']]} {d['conf']:.3f} {np.round(d['box'], 1).tolist()}")
        for d in miss_test:
            print(f"    only in ONNX:    {onnx.labels[d['cls']]} {d['conf']:.3f} {d['box']}")

    print(f"\n{len(paths) - len(bad)}/{len(paths)} images match; {n_pairs} matched boxes; "
          f"worst corner difference {worst_px:.2f}px (tolerance {args.px_tol}px)")
    if len(bad) > args.max_bad_images:
        print(f"FAIL: {len(bad)} mismatched images (allowed {args.max_bad_images}) -> check pre/post-processing")
        sys.exit(1)
    print("PASS" + (f" ({len(bad)} borderline image(s): {', '.join(bad)})" if bad else ""))


if __name__ == "__main__":
    main()
