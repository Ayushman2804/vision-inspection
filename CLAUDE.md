# Steel defect inspection platform

YOLOv8n (NEU-DET, 6 classes) served by FastAPI + ONNX Runtime, behind an Express gateway (JWT auth, Postgres, alerts), with a React/Vite dashboard (Dashboard, Live video, Upload, History).

Read these when the task needs them instead of re-deriving from code:
- [docs/architecture.md](docs/architecture.md): request flow, services, DB schema, env vars
- [docs/project-status.md](docs/project-status.md): milestones, what's done, what's next
- [CHANGELOG.md](CHANGELOG.md): what changed and when
- [README.md](README.md): user-facing setup, training steps, model results, deploy

## Layout

| Folder | Stack | Entry point |
|---|---|---|
| `inference/` | Python 3.11, FastAPI, onnxruntime, OpenCV | `app/main.py`, model code in `app/detector.py` |
| `gateway/` | Node 22+ (ESM), Express 4, pg | `src/server.js` → `src/app.js`, routes in `src/routes/` |
| `frontend/` | React 18, Vite 5, react-router, recharts | `src/App.jsx`, API client `src/api.js` |
| `ml/` | Ultralytics training, export, benchmarks (needs GPU) | scripts run from `ml/` |

## Commands

```bash
docker compose up --build                          # full stack: :5173 UI, :4000 gateway, :8000 inference
MOCK_MODE=true docker compose up --build           # random boxes, no model needed
cd inference && pytest -q                          # letterbox, NMS, postprocess, API (mock mode)
cd gateway && npm test                             # node --test, alert rule
cd frontend && npm run build                       # only frontend check; there are no frontend tests
```

CI (`.github/workflows/ci.yml`) runs those three plus `docker compose build`. Run the relevant one before saying a change works.

## Rules

- Never push to `main`; work on a branch and open a PR.
- Secrets only via env vars. `.env` files are gitignored; update the matching `.env.example` when adding a variable.
- `inference/models/best.onnx` is the deployed model. Don't overwrite it from `ml/export_onnx.py` unless asked; use `--out-dir runs/<name>/onnx` for candidates.
- SQL: always parameterised (`$1`, `$2`). The only interpolated values are already whitelisted or clamped (`unit` in stats, `limit`/`offset` in inspections). Keep it that way.
- Schema changes go in `gateway/db/init.sql` and must stay idempotent (`IF NOT EXISTS`); it runs on every gateway start. There is no migration tool.
- Every gateway query is scoped by `req.user.id`. Keep new endpoints scoped the same way.
- Inference response shape (`detections[].class_name/confidence/bbox/area_pct`, `latency_ms`, `model_version`, `image`) is consumed by the gateway and frontend. Change all three together.
- Default confidence is 0.25 in three places (frontend sliders, gateway fallback, inference default). See README "Confidence threshold" before changing it.
- Model numbers in README come from `docs/results/*/metrics_summary.json`. Don't edit them by hand.

## After finishing a feature

Update `CHANGELOG.md` (Unreleased section) and `docs/project-status.md`. Update `docs/architecture.md` if routes, tables, services or env vars changed.
