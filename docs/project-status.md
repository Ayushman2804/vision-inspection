# Project status

Last updated: 2026-11-09 (evening)

## Milestones

| # | Milestone | Status |
|---|---|---|
| 1 | Full stack running end to end (inference, gateway, Postgres, dashboard) with mock detector | Done |
| 2 | Train YOLOv8n on NEU-DET, export to ONNX, verify parity, benchmark | Done (mAP@0.5 0.717) |
| 3 | Compare YOLOv8s and choose the shipped model | Done: YOLOv8n (superseded by milestone 6) |
| 4 | Real-model demo video and screenshots | Done (screenshots show YOLOv8n) |
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

## Known issues

- Live video sampled ~1 fps instead of 3 fps in the browser-pane test; not yet investigated.
- README screenshots show the YOLOv8n UI (the UI itself is unchanged).
- Uploads are stored on local disk; Cloud Run would lose them on restart.

## Next up

1. Review and merge PR #1.
2. Check the Live page frame rate in a normal browser window.
3. Retake the README screenshots with YOLO26n.
4. Deploy (milestone 8) and replace the 80–120 ms Cloud Run estimate with a measurement.
5. Move uploads to object storage (GCS or R2).
6. Per-class confidence thresholds (YOLO26n: crazing peaks at 0.14; inclusion, patches, scratches near 0.52).
7. Optional: validate YOLO26n's NMS-free branch; it might be faster if accurate.

The full idea list is in the README "Roadmap" section; the day-by-day history is in [devlog.md](devlog.md).
