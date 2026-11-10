# Architecture

## Services

Versions: React 19 / Vite 8 / React Router 7 / Recharts 3 served by nginx 1.30; Node 24 + Express 5; Python 3.13 + FastAPI + ONNX Runtime 1.31; PostgreSQL 18.

```
Browser (React, Vite build served by nginx)
   │  REST + JWT (Authorization: Bearer)
   ▼
gateway  (Express, :4000)  ──multipart POST /predict──►  inference (FastAPI + ONNX Runtime, :8000)
   │  pg pool (max 10)
   ▼
PostgreSQL  (users, inspections, defects, alerts)
```

| Service | Responsibility | Key files |
|---|---|---|
| frontend | Login, dashboard charts, live video sampling, upload, history | `frontend/src/api.js`, `frontend/src/pages/*.jsx`, `frontend/src/components/BBoxCanvas.jsx`, `frontend/src/draw.js` |
| gateway | Auth, rate limits, image validation, persistence, alert rule, stats | `gateway/src/app.js`, `routes/{auth,inspect,stats}.js`, `services/{inference,alerts}.js` |
| inference | Decode image, letterbox to 640, run ONNX, NMS (only for raw-head models; YOLO26 end2end skips it), scale boxes back | `inference/app/main.py`, `inference/app/detector.py` |
| ml | Data prep, training, ONNX export, parity check, benchmark, demo video | `ml/*.py` (offline, not deployed) |

## Inspect request flow

1. Frontend posts multipart `conf`, `source` (`upload` | `video`), `image` to `POST /api/inspect`. Live video samples ~3 fps and keeps at most one request in flight.
2. Gateway: `requireAuth` → multer (memory, 8 MB, JPEG/PNG/WebP) → clamps `conf` to 0.05–0.95 (default 0.25).
3. Gateway forwards the image to `inference /predict?conf=…` (30 s timeout; errors become 502).
4. Inference returns `{ detections: [{class_name, confidence, bbox, area_pct}], latency_ms, model_version, image }`.
5. For `source=upload` only, the original is written to `UPLOAD_DIR` and served at `/uploads/<uuid>.<ext>`. Video frames are never stored.
6. One transaction inserts the `inspections` row (status `fail` if any detection) and its `defects` rows.
7. `evaluateAlert` checks the last `ALERT_WINDOW` inspections. If the fail rate ≥ `ALERT_THRESHOLD` and no alert fired in the last `ALERT_COOLDOWN_SEC`, it stores a `high_defect_rate` alert.
8. Response: `{ inspection, detections, image, alert }`.

## Gateway API

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/auth/register`, `/api/auth/login` | – | 20 req/min limit; JWT valid 12 h; password ≥ 8 chars |
| POST | `/api/inspect` | JWT | see flow above |
| GET | `/api/inspections` | JWT | filters `status`, `source`, `class`; `limit` 1–100, `offset` |
| GET | `/api/stats?days=N` | JWT | N 1–90; hourly buckets when N ≤ 2, else daily; every bucket in the range is returned (empty ones as 0) |
| GET | `/api/alerts` | JWT | last 50 |
| GET | `/api/health` | – | DB `SELECT 1` |
| GET | `/uploads/*` | – | static, 1 day cache |

Global limit: 600 req/min per IP. Every query is scoped to the caller's `user_id`.

## Inference API

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | `model_loaded`, `model_version`, `labels` |
| POST | `/predict` | form field `file`; query `conf` 0.01–0.99 (0.25), `iou` 0.1–0.95 (0.7); 10 MB max; 503 if no model |

Detector choice at startup: `MOCK_MODE=true` → `MockDetector`; else `MODEL_PATH` exists → ONNX `Detector`; else no detector (503).

## Database (`gateway/db/init.sql`, applied on every gateway start)

| Table | Columns | Notes |
|---|---|---|
| users | id, email (unique), password_hash (bcrypt), role (`operator`), created_at | |
| inspections | id, user_id, source, image_path, status, defect_count, latency_ms, model_version, created_at | index (user_id, created_at DESC) |
| defects | id, inspection_id, class_name, confidence, bbox (JSONB), area_pct, reviewed, review_label | `reviewed`/`review_label` reserved for the review queue |
| alerts | id, user_id, rule, details (JSONB), triggered_at | index (user_id, triggered_at DESC) |

## Environment variables

| Service | Variable | Default | Notes |
|---|---|---|---|
| gateway | `PORT` | 4000 | |
| gateway | `DATABASE_URL` | local postgres | |
| gateway | `DB_SSL` | false | true for Neon/Supabase |
| gateway | `JWT_SECRET` | dev value | startup fails in production if unset |
| gateway | `INFERENCE_URL` | http://localhost:8000 | |
| gateway | `CORS_ORIGINS` | http://localhost:5173 | comma-separated |
| gateway | `UPLOAD_DIR` | ./uploads | ephemeral on Cloud Run |
| gateway | `ALERT_WINDOW` / `ALERT_THRESHOLD` / `ALERT_COOLDOWN_SEC` | 20 / 0.5 / 60 | |
| inference | `MODEL_PATH` / `LABELS_PATH` | models/best.onnx / models/labels.json | |
| inference | `MODEL_VERSION` | yolo26n-neu-det-v1 | |
| inference | `MOCK_MODE` | false | wins over the model file |
| inference | `PORT` | 8000 | Docker only |
| frontend | `VITE_API_URL` | http://localhost:4000 | build-time |

Examples: `gateway/.env.example`, `frontend/.env.example`, and the root `.env.example` for `docker compose` overrides.

## Known limits

- Uploads live on local disk; lost on Cloud Run restarts.
- Schema bootstrap only, no migrations: a column change needs a manual `ALTER` on existing databases.
- One global confidence threshold; crazing and rolled-in_scale would do better near 0.20.
