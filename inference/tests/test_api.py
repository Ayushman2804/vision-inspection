import os

os.environ["MOCK_MODE"] = "true"
os.environ["MODEL_PATH"] = "does-not-exist.onnx"

import cv2  # noqa: E402
import numpy as np  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


def _jpeg_bytes():
    img = (np.random.default_rng(0).random((200, 200, 3)) * 255).astype(np.uint8)
    ok, buf = cv2.imencode(".jpg", img)
    assert ok
    return buf.tobytes()


def test_health_and_predict_in_mock_mode():
    with TestClient(app) as client:
        h = client.get("/health").json()
        assert h["model_loaded"] is True and h["model_version"] == "mock"

        r = client.post("/predict?conf=0.3", files={"file": ("x.jpg", _jpeg_bytes(), "image/jpeg")})
        assert r.status_code == 200
        body = r.json()
        assert set(body) >= {"detections", "image", "latency_ms", "model_version"}
        assert body["image"] == {"width": 200, "height": 200}


def test_predict_rejects_garbage():
    with TestClient(app) as client:
        r = client.post("/predict", files={"file": ("x.jpg", b"not an image", "image/jpeg")})
        assert r.status_code == 400
