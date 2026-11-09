"""ONNX Runtime YOLO detector (YOLO26 end2end or YOLOv8-style raw head): letterbox pre-processing,
NumPy post-processing, and NMS when the model doesn't do it itself."""
from __future__ import annotations

import json
import random
import time
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort

DEFAULT_LABELS = ["crazing", "inclusion", "patches", "pitted_surface", "rolled-in_scale", "scratches"]


def load_labels(path: str | None) -> list[str]:
    if path and Path(path).exists():
        data = json.loads(Path(path).read_text())
        if isinstance(data, dict):
            return [data[k] for k in sorted(data, key=int)]
        return list(data)
    return DEFAULT_LABELS


def letterbox(img: np.ndarray, size: int = 640, color: int = 114):
    """Resize keeping aspect ratio and pad to a square. Returns (img, ratio, pad_left, pad_top)."""
    h, w = img.shape[:2]
    r = min(size / h, size / w)
    nh, nw = int(round(h * r)), int(round(w * r))
    resized = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_LINEAR)
    top, left = (size - nh) // 2, (size - nw) // 2
    out = np.full((size, size, 3), color, dtype=np.uint8)
    out[top : top + nh, left : left + nw] = resized
    return out, r, left, top


def nms(boxes: np.ndarray, scores: np.ndarray, iou_thres: float) -> list[int]:
    """Greedy NMS on (n,4) xyxy boxes. Returns kept indices, highest score first."""
    x1, y1, x2, y2 = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
    areas = np.maximum(0, x2 - x1) * np.maximum(0, y2 - y1)
    order = scores.argsort()[::-1]
    keep: list[int] = []
    while order.size > 0:
        i = int(order[0])
        keep.append(i)
        rest = order[1:]
        xx1 = np.maximum(x1[i], x1[rest])
        yy1 = np.maximum(y1[i], y1[rest])
        xx2 = np.minimum(x2[i], x2[rest])
        yy2 = np.minimum(y2[i], y2[rest])
        inter = np.maximum(0, xx2 - xx1) * np.maximum(0, yy2 - yy1)
        iou = inter / (areas[i] + areas[rest] - inter + 1e-9)
        order = rest[iou <= iou_thres]
    return keep


def is_end2end(pred: np.ndarray, nc: int) -> bool:
    """True for NMS-free (YOLO26 end2end) output: (max_det, 6) rows of x1, y1, x2, y2, score, class."""
    return pred.ndim == 2 and pred.shape[1] == 6 and pred.shape[0] != 4 + nc


def _decode_raw(pred: np.ndarray, nc: int):
    """YOLOv8/YOLO11 raw head (4+nc, N) or (N, 4+nc) -> xyxy boxes, scores, class ids (input pixels)."""
    if pred.shape[0] == 4 + nc:
        pred = pred.T  # -> (N, 4+nc)
    boxes, scores = pred[:, :4], pred[:, 4 : 4 + nc]
    class_ids = scores.argmax(axis=1)
    confs = scores[np.arange(len(scores)), class_ids]
    xyxy = np.empty_like(boxes)
    xyxy[:, 0] = boxes[:, 0] - boxes[:, 2] / 2
    xyxy[:, 1] = boxes[:, 1] - boxes[:, 3] / 2
    xyxy[:, 2] = boxes[:, 0] + boxes[:, 2] / 2
    xyxy[:, 3] = boxes[:, 1] + boxes[:, 3] / 2
    return xyxy, confs, class_ids


# NMS IoU 0.7 matches ultralytics val, so deployed behaviour matches the reported mAP.
def postprocess(output, ratio, pad_left, pad_top, orig_w, orig_h, conf_thres=0.25, iou_thres=0.7, labels=None):
    """Decode model output into detections in original-image pixels.

    Supports both export formats:
    - raw YOLOv8/YOLO11 head, shape (1, 4+nc, N): cx, cy, w, h + per-class scores; needs NMS here.
    - NMS-free YOLO26 end2end, shape (1, max_det, 6): x1, y1, x2, y2, score, class; NMS already done
      by the model, so `iou_thres` is ignored.
    """
    labels = labels or DEFAULT_LABELS
    nc = len(labels)
    pred = np.squeeze(output, axis=0)
    end2end = is_end2end(pred, nc)
    if end2end:
        xyxy, confs, class_ids = pred[:, :4].copy(), pred[:, 4], pred[:, 5].astype(int)
    else:
        xyxy, confs, class_ids = _decode_raw(pred, nc)

    mask = (confs >= conf_thres) & (class_ids >= 0) & (class_ids < nc)
    if not mask.any():
        return []
    xyxy, confs, class_ids = xyxy[mask], confs[mask], class_ids[mask]

    xyxy[:, [0, 2]] = ((xyxy[:, [0, 2]] - pad_left) / ratio).clip(0, orig_w)
    xyxy[:, [1, 3]] = ((xyxy[:, [1, 3]] - pad_top) / ratio).clip(0, orig_h)

    if end2end:
        keep = [int(i) for i in confs.argsort()[::-1]]
    else:
        keep = nms(xyxy + class_ids[:, None] * 4096.0, confs, iou_thres)  # class-aware NMS via offset trick
    img_area = float(orig_w * orig_h)
    dets = []
    for i in keep:
        x1, y1, x2, y2 = (float(v) for v in xyxy[i])
        cid = int(class_ids[i])
        dets.append(
            {
                "class_id": cid,
                "class_name": labels[cid],
                "confidence": round(float(confs[i]), 4),
                "bbox": [round(x1, 1), round(y1, 1), round(x2, 1), round(y2, 1)],
                "area_pct": round((x2 - x1) * (y2 - y1) / img_area * 100, 2),
            }
        )
    return dets


class Detector:
    def __init__(self, model_path: str, labels_path: str | None = None, model_version: str = "unknown",
                 providers: list[str] | None = None):
        if providers is None:  # default: CUDA when available, else CPU
            available = ort.get_available_providers()
            providers = [p for p in ("CUDAExecutionProvider", "CPUExecutionProvider") if p in available]
        self.session = ort.InferenceSession(model_path, providers=providers)
        inp = self.session.get_inputs()[0]
        self.input_name = inp.name
        self.imgsz = int(inp.shape[2]) if isinstance(inp.shape[2], int) else 640
        self.labels = load_labels(labels_path)
        self.model_version = model_version

    def predict(self, bgr: np.ndarray, conf: float = 0.25, iou: float = 0.7) -> dict:
        t0 = time.perf_counter()
        h, w = bgr.shape[:2]
        img, ratio, left, top = letterbox(bgr, self.imgsz)
        blob = np.ascontiguousarray(img[:, :, ::-1].transpose(2, 0, 1)[None], dtype=np.float32) / 255.0
        out = self.session.run(None, {self.input_name: blob})[0]
        dets = postprocess(out, ratio, left, top, w, h, conf, iou, self.labels)
        return {
            "detections": dets,
            "image": {"width": w, "height": h},
            "latency_ms": round((time.perf_counter() - t0) * 1000, 2),
            "model_version": self.model_version,
        }


class MockDetector:
    """Random-but-plausible detections so the frontend/gateway can be built before the model is trained."""

    model_version = "mock"
    labels = DEFAULT_LABELS

    def predict(self, bgr: np.ndarray, conf: float = 0.25, iou: float = 0.7) -> dict:
        t0 = time.perf_counter()
        h, w = bgr.shape[:2]
        rng = random.Random(int(float(bgr.mean()) * 1000))
        dets = []
        if rng.random() < 0.6:
            for _ in range(rng.randint(1, 2)):
                bw, bh = rng.uniform(0.15, 0.4) * w, rng.uniform(0.15, 0.4) * h
                x1, y1 = rng.uniform(0, w - bw), rng.uniform(0, h - bh)
                cid = rng.randrange(len(self.labels))
                c = round(rng.uniform(max(conf, 0.3), 0.95), 4)
                dets.append(
                    {
                        "class_id": cid,
                        "class_name": self.labels[cid],
                        "confidence": c,
                        "bbox": [round(x1, 1), round(y1, 1), round(x1 + bw, 1), round(y1 + bh, 1)],
                        "area_pct": round(bw * bh / (w * h) * 100, 2),
                    }
                )
        return {
            "detections": dets,
            "image": {"width": w, "height": h},
            "latency_ms": round((time.perf_counter() - t0) * 1000, 2),
            "model_version": self.model_version,
        }
