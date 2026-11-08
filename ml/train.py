"""Train YOLOv8 on the prepared NEU-DET dataset (local GPU).

Usage:
    python train.py --data data/neu-det/data.yaml --model yolov8n.pt --epochs 100
"""
import argparse
import json
from pathlib import Path

from ultralytics import YOLO


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data/neu-det/data.yaml")
    ap.add_argument("--model", default="yolov8n.pt", help="yolov8n.pt / yolov8s.pt ...")
    ap.add_argument("--epochs", type=int, default=100)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--device", default="0", help="GPU index, or 'cpu'")
    ap.add_argument("--name", default="neu-det-v1")
    ap.add_argument("--workers", type=int, default=4, help="dataloader workers (Windows struggles with 8)")
    ap.add_argument("--cache", action="store_true", help="cache images in RAM (NEU-DET is small)")
    args = ap.parse_args()

    model = YOLO(args.model)
    model.train(
        data=args.data,
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        device=args.device,
        workers=args.workers,
        cache=args.cache,
        # Absolute path: newer Ultralytics nests a relative project under runs/detect/.
        project=str(Path("runs").resolve()),
        name=args.name,
        patience=30,
        plots=True,
        seed=42,
    )
    save_dir = Path(model.trainer.save_dir)  # may be <name>2, <name>3... if the name already exists

    metrics = model.val(data=args.data, imgsz=args.imgsz, device=args.device,
                        project=str(save_dir), name="val", exist_ok=True)
    summary = {
        "model": args.model,
        "mAP50": float(metrics.box.map50),
        "mAP50-95": float(metrics.box.map),
        "precision": float(metrics.box.mp),
        "recall": float(metrics.box.mr),
        "per_class_AP50": {
            metrics.names[i]: float(ap50) for i, ap50 in zip(metrics.box.ap_class_index, metrics.box.ap50)
        },
    }
    out = save_dir / "metrics_summary.json"
    with open(out, "w") as f:
        json.dump(summary, f, indent=2)
    print(json.dumps(summary, indent=2))
    print(f"Saved -> {out}")


if __name__ == "__main__":
    main()
