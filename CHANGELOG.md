# Changelog

## Unreleased

- Add `CLAUDE.md`, `docs/architecture.md`, `docs/project-status.md`, this changelog, and a root `.env.example` for `docker compose` overrides.
- Docker images moved from Node 20 to Node 24 and gateway `engines` raised to `>=22`, matching CI.

## 2026-11-08: YOLOv8s comparison, YOLOv8n ships

- Trained YOLOv8s with the same settings. It gave +0.016 mAP@0.5 at 2.75× the CPU latency, so YOLOv8n stays the shipped model.
- Added metrics, curves and confusion matrices under `docs/results/`.
- Real-model demo video (`frontend/public/sample.mp4`) and screenshots.
- `MOCK_MODE` now takes precedence over a committed `best.onnx`.

## 2026-11-08: Initial release

- FastAPI + ONNX Runtime inference service (letterbox, NMS, mock mode).
- Express gateway: JWT auth, inspect, history, stats, defect-rate alerts, Postgres schema bootstrap.
- React dashboard: Dashboard, Live video (3 fps browser sampling), Upload, History.
- ML scripts: NEU-DET prep, training, ONNX export, parity check, benchmark, demo video.
- CI for inference tests, gateway tests, frontend build and `docker compose build`.
