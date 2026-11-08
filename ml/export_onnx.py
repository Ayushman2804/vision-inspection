"""Export trained weights to ONNX and install them into the inference service.

Usage:
    python export_onnx.py --weights runs/neu-det-v1/weights/best.pt --version yolov8n-neu-det-v1
"""
import argparse
import json
import shutil
from pathlib import Path

from ultralytics import YOLO

MODELS_DIR = Path(__file__).resolve().parents[1] / "inference" / "models"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", required=True)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--version", default="yolov8n-neu-det-v1")
    args = ap.parse_args()

    model = YOLO(args.weights)
    onnx_path = Path(model.export(format="onnx", imgsz=args.imgsz, opset=12, simplify=True, dynamic=False))

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy(onnx_path, MODELS_DIR / "best.onnx")
    labels = [model.names[i] for i in sorted(model.names)]
    (MODELS_DIR / "labels.json").write_text(json.dumps(labels, indent=2))
    (MODELS_DIR / "model_meta.json").write_text(
        json.dumps({"version": args.version, "imgsz": args.imgsz, "labels": labels}, indent=2)
    )
    print(f"Installed {onnx_path.name} -> {MODELS_DIR}")
    print(f"Set MODEL_VERSION={args.version} for the inference service.")


if __name__ == "__main__":
    main()
