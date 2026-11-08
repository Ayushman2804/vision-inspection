import os
from contextlib import asynccontextmanager

import cv2
import numpy as np
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from starlette.concurrency import run_in_threadpool

from .detector import Detector, MockDetector

MODEL_PATH = os.getenv("MODEL_PATH", "models/best.onnx")
LABELS_PATH = os.getenv("LABELS_PATH", "models/labels.json")
MODEL_VERSION = os.getenv("MODEL_VERSION", "yolov8n-neu-det-v1")
MOCK_MODE = os.getenv("MOCK_MODE", "false").lower() in ("1", "true", "yes")
MAX_BYTES = 10 * 1024 * 1024

state: dict = {"detector": None}


@asynccontextmanager
async def lifespan(_: FastAPI):
    if os.path.exists(MODEL_PATH):
        state["detector"] = Detector(MODEL_PATH, LABELS_PATH, MODEL_VERSION)
    elif MOCK_MODE:
        state["detector"] = MockDetector()
    yield
    state["detector"] = None


app = FastAPI(title="Steel Defect Inference Service", version="1.0.0", lifespan=lifespan)


@app.get("/health")
def health():
    det = state["detector"]
    return {
        "status": "ok" if det is not None else "model_not_loaded",
        "model_loaded": det is not None,
        "model_version": getattr(det, "model_version", None),
        "labels": getattr(det, "labels", None),
    }


@app.post("/predict")
async def predict(
    file: UploadFile = File(...),
    conf: float = Query(0.25, ge=0.01, le=0.99),
    iou: float = Query(0.7, ge=0.1, le=0.95),
):
    det = state["detector"]
    if det is None:
        raise HTTPException(503, "Model not loaded. Train/export a model or set MOCK_MODE=true.")
    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "Image too large (max 10 MB)")
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, "Could not decode image")
    return await run_in_threadpool(det.predict, img, conf, iou)
