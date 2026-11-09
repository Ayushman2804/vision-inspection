# Project status

Last updated: 2026-11-09

## Milestones

| # | Milestone | Status |
|---|---|---|
| 1 | Full stack running end to end (inference, gateway, Postgres, dashboard) with mock detector | Done |
| 2 | Train YOLOv8n on NEU-DET, export to ONNX, verify parity, benchmark | Done (mAP@0.5 0.717, CPU p50 29 ms) |
| 3 | Compare YOLOv8s and choose the shipped model | Done: YOLOv8n ships (see README "Model choice") |
| 4 | Real-model demo video and screenshots | Done |
| 5 | Stack upgrade (React 19, Vite 8, Router 7, Recharts 3, Express 5, Python 3.13, Postgres 18, nginx 1.30) | Done, verified locally; not committed |
| 6 | Evaluate YOLO26n against YOLOv8n and ship it if it holds up | Done: YOLO26n ships (mAP@0.5 0.739, CPU p50 31 ms vs 36 ms); not committed |
| 7 | Deploy (Neon + Cloud Run + Vercel) and measure real Cloud Run latency | Not started |
| 8 | Human review queue and retraining export | Not started |

## Where things stand

- `main` has the YOLOv8n model, results and screenshots.
- Branch `chore/claude-code-setup` (not merged, not pushed): two commits (Node 24 runtime; CLAUDE.md and docs), plus the uncommitted stack upgrade.
- Upgrade checks: inference tests 8/8 on Python 3.13, gateway tests 7/7 on Express 5, frontend builds on Vite 8, and the Docker stack runs with Live video and the Dashboard working in the browser.
- YOLO26n is deployed in `inference/models/` (raw head + NMS, parity 50/50) and verified in the running app. Results in `docs/results/yolo26n/`. YOLOv8n backup: `ml/runs/backup-yolov8n-models/`.
- YOLO26n's NMS-free (`--end2end`) export is not used: it disagrees with the validated head on 37/50 images and hasn't been validated itself.
- Local Postgres moved to a new `pgdata18` volume, so earlier local history isn't shown. The old `pgdata` volume is still on disk.
- Demo history is mock data from `npm run seed` (tagged `seed-demo`) until real line data is available.
- Live video sampled ~1 fps instead of 3 fps in the browser pane test; not yet investigated.

## Next up

1. Commit the upgrade and model swap, push the branch, open a PR.
2. Check the Live page frame rate in a normal browser window.
3. Retake the README screenshots with YOLO26n.
4. Deploy (milestone 7) and replace the 80–120 ms Cloud Run estimate with a measurement.
5. Move uploads to object storage (GCS or R2).
6. Per-class confidence thresholds (YOLO26n: crazing peaks at 0.14; inclusion, patches, scratches near 0.52).
7. Optional: validate YOLO26n's NMS-free branch; it might be faster if accurate.

The full idea list is in the README "Roadmap" section.
