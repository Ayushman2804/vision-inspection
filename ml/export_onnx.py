"""Export trained weights to ONNX and install them into the inference service.

Usage:
    python export_onnx.py --weights runs/neu-det-v1-26n/weights/best.pt --version yolo26n-neu-det-v1

By default this overwrites the deployed model in inference/models/. To evaluate a candidate without
touching it, pass --out-dir, e.g. --out-dir runs/neu-det-v1-s/onnx
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
    ap.add_argument("--version", default="yolo26n-neu-det-v1")
    ap.add_argument("--opset", type=int, default=None,
                    help="ONNX opset (default: let Ultralytics pick one the model supports; YOLOv8 was exported with 12)")
    ap.add_argument("--out-dir", default=str(MODELS_DIR),
                    help="where to write best.onnx/labels.json/model_meta.json (default: the deployed inference/models)")
    ap.add_argument("--end2end", action="store_true",
                    help="YOLO26: export the NMS-free head, output (1, 300, 6). Without it you get the raw (1, 4+nc, 8400) head")
    args = ap.parse_args()

    model = YOLO(args.weights)
    extra = {"nms": False} if args.end2end else {}  # Ultralytics 8.4 exports the end2end branch only when nms=False
    onnx_path = Path(model.export(format="onnx", imgsz=args.imgsz, opset=args.opset, simplify=True, dynamic=False, **extra))

    out = Path(args.out_dir).resolve()
    out.mkdir(parents=True, exist_ok=True)
    shutil.copy(onnx_path, out / "best.onnx")
    labels = [model.names[i] for i in sorted(model.names)]
    (out / "labels.json").write_text(json.dumps(labels, indent=2))
    (out / "model_meta.json").write_text(
        json.dumps({"version": args.version, "imgsz": args.imgsz, "labels": labels}, indent=2)
    )
    print(f"Wrote {onnx_path.name} -> {out}")
    if out == MODELS_DIR.resolve():
        print(f"Set MODEL_VERSION={args.version} for the inference service.")


if __name__ == "__main__":
    main()
