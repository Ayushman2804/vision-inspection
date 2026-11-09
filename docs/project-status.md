# Project status

Last updated: 2026-11-09 (evening)

## Milestones

| # | Milestone | Status |
|---|---|---|
| 1 | Full stack running end to end (inference, gateway, Postgres, dashboard) with mock detector | Done |
| 2 | Train YOLOv8n on NEU-DET, export to ONNX, verify parity, benchmark | Done (mAP@0.5 0.717) |
| 3 | Compare YOLOv8s and choose the shipped model | Done: YOLOv8n (superseded by milestone 6) |
| 4 | Real-model demo video and screenshots | Done (screenshots retaken with YOLO26n) |
| 5 | Stack upgrade (React 19, Vite 8, Router 7, Recharts 3, Express 5, Python 3.13, Postgres 18, nginx 1.30) | Done; in PR #1, CI green |
| 6 | Evaluate YOLO26n against YOLOv8n and ship it if it holds up | Done: YOLO26n (mAP@0.5 0.739, CPU p50 31 vs 36 ms); in PR #1 |
| 7 | Merge PR #1 into `main` | Waiting on review |
| 8 | Deploy (Neon + Cloud Run + Vercel) and measure real Cloud Run latency | Not started |
| 9 | Human review queue and retraining export | Not started |

## Where things stand

- `main` still has YOLOv8n and the old stack. Everything new is on `chore/claude-code-setup`.
- **PR #1** (https://github.com/Ayushman2804/vision-inspection/pull/1): 6 commits, open, ready for review, mergeable. CI passes all 4 jobs (inference, gateway, frontend, docker-build). Auto-fix is on, so CI failures and review comments wake the Claude session.
- Local checks: inference 8/8 on Python 3.13, gateway 7/7 on Express 5, frontend builds on Vite 8, Docker stack running with YOLO26n (~31–34 ms per frame in the container).
- YOLO26n runs as the raw head + NMS (parity 50/50, max 0.06 px). The NMS-free `--end2end` export is not used: it disagrees on 37/50 images and isn't validated. YOLOv8n backup: `ml/runs/backup-yolov8n-models/` (local, gitignored).
- Local Postgres uses the new `pgdata18` volume; demo history comes from `npm run seed` (tagged `seed-demo`), not real line data.
- Training run, ONNX candidates and logs live in `ml/runs/` (gitignored); results worth keeping are copied to `docs/results/yolo26n/`.

## Pre-merge checks (PR #1)

- UI: all four pages render after the React 19 / Vite 8 / Router 7 / Recharts 3 upgrade, both Dashboard charts draw with data, no console errors.
- `scripts/e2e_check.js`: 27/27 against the running stack (ALERT_WINDOW 20 and 3).
- Live page: 3.0 fps when the tab is focused (round trip ~61 ms: ~35 ms model, ~26 ms gateway + DB). The earlier ~1 fps was the browser throttling `canvas.toBlob()` in a hidden tab, not an app bug; documented in the README.
- Screenshots retaken against YOLO26n with real inspections only.

## Known issues

- Live sampling drops to ~1–2 fps when the tab is hidden (browser throttles `toBlob`).
- Uploads are stored on local disk; Cloud Run would lose them on restart. `/uploads/*` is served without auth (unguessable UUID names only).
- `scripts/e2e_check.js` isn't in CI yet (needs a Postgres service container).

## Next up

1. Merge PR #1.
2. Run `scripts/e2e_check.js` in CI with a Postgres service container.
3. Deploy (milestone 8) and replace the 80–120 ms Cloud Run estimate with a measurement.
4. Move uploads to object storage (GCS or R2).
5. Per-class confidence thresholds (YOLO26n: crazing peaks at 0.14; inclusion, patches, scratches near 0.52).
6. Optional: validate YOLO26n's NMS-free branch; it might be faster if accurate.

The full idea list is in the README "Roadmap" section; the day-by-day history is in [devlog.md](devlog.md).
