# Steel defect inspection platform

YOLO26n (NEU-DET, 6 classes; replaced YOLOv8n on 2026-11-09) served by FastAPI + ONNX Runtime, behind an Express gateway (JWT auth, Postgres, alerts), with a React/Vite dashboard (Dashboard, Live video, Upload, History).

Read these when the task needs them instead of re-deriving from code:
- [docs/architecture.md](docs/architecture.md): request flow, services, DB schema, env vars
- [docs/project-status.md](docs/project-status.md): milestones, what's done, what's next
- [CHANGELOG.md](CHANGELOG.md): what changed and when
- [docs/devlog.md](docs/devlog.md): daily log of work, decisions and open items (read the latest entry when picking work back up)
- [README.md](README.md): user-facing setup, training steps, model results, deploy

## Layout

| Folder | Stack | Entry point |
|---|---|---|
| `inference/` | Python 3.13, FastAPI, onnxruntime 1.31+, OpenCV | `app/main.py`, model code in `app/detector.py` |
| `gateway/` | Node 24 (ESM, `>=22`), Express 5, pg | `src/server.js` → `src/app.js`, routes in `src/routes/` |
| `frontend/` | React 19, Vite 8, React Router 7 (`react-router`), Recharts 3 | `src/App.jsx` (pages lazy-loaded), API client `src/api.js` |
| `ml/` | Ultralytics 8.4+ training, export, benchmarks (needs GPU) | scripts run from `ml/` |
| infra | Postgres 18, nginx 1.30 (serves the built frontend), Docker Compose | `docker-compose.yml` |

## Commands

```bash
docker compose up --build                          # full stack: :5173 UI, :4000 gateway, :8000 inference
MOCK_MODE=true docker compose up --build           # random boxes, no model needed
cd inference && pytest -q                          # letterbox, NMS, postprocess, API (mock mode)
cd gateway && npm test                             # node --test, alert rule
cd frontend && npm run build                       # only frontend check; there are no frontend tests
docker compose cp ml/data/neu-det/images/val gateway:/tmp/neu-val && docker compose exec gateway npm run seed -- --reset  # real-model demo week (gateway/.env.example)
```

CI (`.github/workflows/ci.yml`) runs those three plus `docker compose build`. Run the relevant one before saying a change works.

## Rules

- Never push to `main`; work on a branch and open a PR.
- Secrets only via env vars. `.env` files are gitignored; update the matching `.env.example` when adding a variable.
- `inference/models/best.onnx` is the deployed model (YOLO26n, raw head + NMS). Don't overwrite it from `ml/export_onnx.py` unless asked; use `--out-dir runs/<name>/onnx` for candidates. Don't ship an `--end2end` export without validating it: it gives different detections.
- SQL: always parameterised (`$1`, `$2`). The only interpolated values are already whitelisted or clamped (`unit` in stats, `limit`/`offset` in inspections). Keep it that way.
- Schema changes go in `gateway/db/init.sql` and must stay idempotent (`IF NOT EXISTS`); it runs on every gateway start. There is no migration tool.
- Every gateway query is scoped by `req.user.id`. Keep new endpoints scoped the same way.
- Express 5: route handlers are plain `async` functions; thrown errors and rejected promises reach the error middleware in `app.js` on their own. Don't add try/catch just to call `next(err)`.
- `app/detector.py` decodes both ONNX formats: YOLO26 end2end `(1, 300, 6)` (no NMS needed) and the YOLOv8-style raw head `(1, 4+nc, 8400)` (NMS in NumPy). Keep both working and tested.
- Inference response shape (`detections[].class_name/confidence/bbox/area_pct`, `latency_ms`, `model_version`, `image`) is consumed by the gateway and frontend. Change all three together.
- Default confidence is 0.25 in three places (frontend sliders, gateway fallback, inference default). See README "Confidence threshold" before changing it.
- Seed data from `gateway/scripts/seed-demo.js` is real model output on NEU-DET val images with backdated timestamps, tagged `model_version = 'seed-demo:<version>'`. Say it's seeded wherever it's shown (README screenshots), and don't seed production.
- Model numbers in README come from `docs/results/*/metrics_summary.json`. Don't edit them by hand.

## After finishing a feature

Update `CHANGELOG.md` (Unreleased section) and `docs/project-status.md`, and add to today's entry in `docs/devlog.md` (create it from the template if missing; newest first). Update `docs/architecture.md` if routes, tables, services or env vars changed.
