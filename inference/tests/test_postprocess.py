import numpy as np

from app.detector import DEFAULT_LABELS, letterbox, nms, postprocess


def test_letterbox_square_and_ratio():
    img = np.zeros((200, 300, 3), dtype=np.uint8)
    out, ratio, left, top = letterbox(img, 640)
    assert out.shape == (640, 640, 3)
    assert abs(ratio - 640 / 300) < 1e-6
    assert left == 0 and top > 0


def test_nms_suppresses_overlap_keeps_distant():
    boxes = np.array([[0, 0, 10, 10], [1, 1, 11, 11], [50, 50, 60, 60]], dtype=float)
    scores = np.array([0.9, 0.8, 0.7])
    assert nms(boxes, scores, 0.5) == [0, 2]


def _raw_output(entries, nc=6, n=8400):
    out = np.zeros((1, 4 + nc, n), dtype=np.float32)
    for i, (cx, cy, w, h, cls, conf) in enumerate(entries):
        out[0, 0:4, i] = [cx, cy, w, h]
        out[0, 4 + cls, i] = conf
    return out


def test_postprocess_maps_back_to_original_coords_and_applies_nms():
    # 200x200 image letterboxed to 640 -> ratio 3.2, no padding
    out = _raw_output(
        [
            (320, 320, 64, 64, 2, 0.9),   # -> bbox [90, 90, 110, 110] in original pixels
            (322, 320, 64, 64, 2, 0.8),   # duplicate, suppressed by NMS
            (64, 64, 32, 32, 5, 0.1),     # below threshold
        ]
    )
    dets = postprocess(out, ratio=3.2, pad_left=0, pad_top=0, orig_w=200, orig_h=200, conf_thres=0.25)
    assert len(dets) == 1
    d = dets[0]
    assert d["class_name"] == DEFAULT_LABELS[2]
    assert d["bbox"] == [90.0, 90.0, 110.0, 110.0]
    assert d["confidence"] > 0.89
    assert abs(d["area_pct"] - 1.0) < 0.01


def test_postprocess_empty_when_nothing_confident():
    out = _raw_output([(100, 100, 20, 20, 0, 0.05)])
    assert postprocess(out, 1.0, 0, 0, 640, 640, conf_thres=0.25) == []
