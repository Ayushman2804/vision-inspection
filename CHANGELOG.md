# Changelog

## Unreleased

Everything below is in PR #1 (`chore/claude-code-setup` → `main`), CI green, not merged yet.

### Stack upgrade
- Frontend: React 18 → 19.3, Vite 5 → 8.3 (`@vitejs/plugin-react` 6), React Router 6 → 7.18 (imports from `react-router`; `react-router-dom` removed), Recharts 2 → 3.10.
- Frontend pages are lazy-loaded, so Recharts only loads with the Dashboard (initial JS 264 kB instead of 675 kB).
- Dashboard legend keeps series order (Recharts 3 sorts alphabetically by default).
- Gateway: Express 4 → 5.3. Route handlers are plain `async` functions; the `asyncHandler` wrapper was removed because Express 5 forwards rejected promises to the error middleware.
- Gateway tests: async errors reach the JSON error handler, auth guard returns 401, unknown routes return JSON 404.
- Inference: Python 3.11 → 3.13 (Docker and CI), FastAPI ≥ 0.162, ONNX Runtime ≥ 1.31.
- Inference decodes YOLO26's NMS-free end-to-end output `(1, 300, 6)` as well as the YOLOv8 raw head; tests cover both.
- `ml/export_onnx.py`: `--opset` option (default lets Ultralytics choose); `ml/requirements.txt` needs Ultralytics ≥ 8.4 for YOLO26.
- PostgreSQL 16 → 18 (new `pgdata18` volume mounted at `/var/lib/postgresql`, as the 18 image expects); nginx 1.27 → 1.30.6.

### Model: YOLO26n replaces YOLOv8n
- Trained YOLO26n on NEU-DET with the YOLOv8n settings (100 epochs, ~50 min on an RTX 3050).
- mAP@0.5 0.717 → 0.739, mAP@0.5:0.95 0.380 → 0.404, better AP@0.5 on all 6 classes; 2.5 M parameters vs 3.1 M.
- CPU p50 35.5 → 31.1 ms (same-session benchmark); GPU ~1 ms slower.
- Deployed as the raw head + NMS (parity 50/50 images, max 0.06 px). `MODEL_VERSION` default is now `yolo26n-neu-det-v1`.
- `ml/export_onnx.py --end2end` exports the NMS-free branch; not used because it disagrees with the validated head.
- `ml/monitor.html`: live per-epoch training dashboard.
- README results, model choice and confidence-threshold sections updated; artifacts in `docs/results/yolo26n/`.

### Demo data
- `npm run seed` (gateway): mock inspection history for a demo user (default ~240 inspections over 7 days, NEU-DET-like class mix, one high-defect shift with alerts). `--days`, `--per-day`, `--reset`. Rows tagged `model_version = 'seed-demo'`; refuses `NODE_ENV=production`.

### Project setup
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
