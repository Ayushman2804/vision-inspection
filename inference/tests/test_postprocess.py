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


def _end2end_output(rows, max_det=300):
    """YOLO26 end2end export: (1, max_det, 6) rows of x1, y1, x2, y2, score, class, zero-padded."""
    out = np.zeros((1, max_det, 6), dtype=np.float32)
    for i, row in enumerate(rows):
        out[0, i] = row
    return out


def test_postprocess_end2end_maps_coords_and_skips_nms():
    # Same geometry as the raw-head test: 200x200 image, ratio 3.2, no padding.
    out = _end2end_output(
        [
            (288, 288, 352, 352, 0.9, 2),  # -> bbox [90, 90, 110, 110]
            (290, 288, 354, 352, 0.8, 2),  # overlapping: the model already decided to keep it
            (40, 40, 80, 80, 0.1, 5),      # below threshold
        ]
    )
    dets = postprocess(out, ratio=3.2, pad_left=0, pad_top=0, orig_w=200, orig_h=200, conf_thres=0.25)
    assert [d["confidence"] for d in dets] == [0.9, 0.8]
    assert dets[0]["class_name"] == DEFAULT_LABELS[2]
    assert dets[0]["bbox"] == [90.0, 90.0, 110.0, 110.0]


def test_postprocess_end2end_empty_padding_rows():
    assert postprocess(_end2end_output([]), 1.0, 0, 0, 640, 640, conf_thres=0.25) == []


def test_ort_threads_from_env(monkeypatch):
    from app.detector import ort_threads_from_env, session_options

    monkeypatch.delenv("ORT_THREADS", raising=False)
    assert ort_threads_from_env() == 1
    monkeypatch.setenv("ORT_THREADS", "4")
    assert ort_threads_from_env() == 4
    monkeypatch.setenv("ORT_THREADS", "0")  # ORT's own default (one thread per core)
    assert ort_threads_from_env() == 0
    for bad in ("-2", "many", ""):
        monkeypatch.setenv("ORT_THREADS", bad)
        assert ort_threads_from_env() == 1
    so = session_options(2)
    assert so.intra_op_num_threads == 2 and so.inter_op_num_threads == 2
