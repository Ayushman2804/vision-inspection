# Changelog

## Unreleased

### UI redesign
- Fixed left sidebar on wide screens (grouped Monitor / Records navigation, signed-in email, Sign out); collapses to a top bar below 900 px with the four links on one row.
- Blued-steel palette with Cloudflare-orange accent; Barlow / Barlow Semi Condensed type (Google Fonts) with tabular figures.
- Icons on KPI tiles, section headers and navigation (inline SVG, no icon dependency).
- Floating "Inspect an image" button (bottom right, expands on hover, hidden on Upload).
- Background of slowly drifting outlines of the six NEU-DET defect classes; still when reduced motion is preferred.
- Live and Upload use a 3:2 split on wide screens. The throughput chart draws Inspected as a filled area so it stays visible under Defective at a 100% defect rate.

## 2026-11-10: PR #3 (5c98614) and PR #2 merged

### Dashboard resilience and phone layout
- Loading skeletons sized like the real content: Dashboard KPI tiles and chart blocks, History rows; route chunks show a spinner. Skeletons appear only on a page's first load; the 10 s Dashboard poll and other background refreshes show a small dot instead.
- Upload shows a spinner over the image while analyzing. A failed inspection keeps the file and preview and offers Retry.
- Live pauses sampling after 3 consecutive failed frames, says why, and offers Resume (single failures are still skipped).
- Dashboard and History show fetch errors with Retry and keep the last data on a failed background refresh. A 401 still signs out and never offers Retry (`ApiError.retryable`).
- History and Dashboard refetch when Upload or Live store an inspection (in-app signal, also broadcast to other tabs) and on window focus. Throttled to one refetch per 4 s, never overlapping an in-flight request; rows only come from the server.
- Phone layout: no horizontal overflow at 360–414 px. History becomes one card per row below 640 px (the 7-column table was 477 px wide at 360 px); nav links get their own row; KPI tiles in two columns; "Defects by class" is a horizontal bar chart (no angled labels).
- `GET /api/stats`: the timeline is zero-filled with `generate_series`, so empty hours/days plot as 0 instead of being skipped. New gateway test covers a range with a gap (needs Postgres; CI's gateway job now has a Postgres service and `REQUIRE_DB=1`).

### Experiment: NEU-DET + GC10-DET (not shipped)
- `ml/prepare_combined.py` builds a 16-class YOLO dataset from NEU-DET and GC10-DET (Hugging Face mirror `lzhzj/gc10-det`, CC BY 4.0), with per-source validation splits.
- Trained a combined YOLO26n: NEU-DET mAP@0.5 0.747 vs 0.739 shipped (mAP@0.5:0.95 0.395 vs 0.404), GC10-DET 0.689, ~2 ms slower on CPU. Kept the shipped model. Results in `docs/results/neu-gc10-26n/`.
- `ml/train.py --resume LAST_PT` continues an interrupted run and still writes `metrics_summary.json`.
- `ml/monitor.html`: time-per-epoch/ETA uses recent epoch gaps, so it stays right after a resume.

## 2026-11-09: Real-model seed, committed to `main` (2f7d653)

### Demo data from the real model
- `npm run seed` now posts NEU-DET validation images through `POST /api/inspect` (default 120, ~1 upload : 4 video), so every detection is real YOLO26n output; it then backdates the rows over 7 days with uneven daily volume. Tag is now `seed-demo:<model version>`; `--reset` also deletes seeded upload files.
- Dashboard and History screenshots retaken on the seeded data; README says the history is seeded.
- Roadmap: `/uploads/*` access control folded into the object-storage item (signed URLs).

## 2026-11-09: PR #1 merged (56cbd64)

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
- `npm run seed` (gateway): first version generated synthetic inspection rows; replaced by the real-model seed above.

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
