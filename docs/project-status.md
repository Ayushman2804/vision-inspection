# Project status

Last updated: 2026-11-10

## Milestones

| # | Milestone | Status |
|---|---|---|
| 1 | Full stack running end to end (inference, gateway, Postgres, dashboard) with mock detector | Done |
| 2 | Train YOLOv8n on NEU-DET, export to ONNX, verify parity, benchmark | Done (mAP@0.5 0.717) |
| 3 | Compare YOLOv8s and choose the shipped model | Done: YOLOv8n (superseded by milestone 6) |
| 4 | Real-model demo video and screenshots | Done (screenshots retaken with YOLO26n) |
| 5 | Stack upgrade (React 19, Vite 8, Router 7, Recharts 3, Express 5, Python 3.13, Postgres 18, nginx 1.30) | Done; in PR #1, CI green |
| 6 | Evaluate YOLO26n against YOLOv8n and ship it if it holds up | Done: YOLO26n (mAP@0.5 0.739, CPU p50 31 vs 36 ms); in PR #1 |
| 7 | Merge PR #1 into `main` | Done (56cbd64) |
| 8 | Deploy (Neon + Cloud Run + Vercel) and measure real Cloud Run latency | Not started |
| 7a | Frontend resilience (skeletons, retry, live sync, phone layout) and zero-filled stats timeline | Done; PR #2 merged |
| 7b | UI redesign (sidebar layout, icons, floating action button) | Kept on branch `upgrade`, not merged into `main` |
| 8a | Experiment: NEU-DET + GC10-DET combined 16-class model | Done, not shipped (NEU-DET tie: 0.747 vs 0.739 mAP@0.5; GC10 0.689); recorded in PR #3 (5c98614) |
| 9 | Human review queue and retraining export | Not started |

## Where things stand

- `main` has PR #1 (56cbd64), the real-model seed (2f7d653), PR #3 (GC10 experiment record, 5c98614) and PR #2 (frontend resilience), all with CI green on the 4 jobs. Open: PR #4 (UI redesign, built on PR #2's branch).
- Local checks: inference 8/8 on Python 3.13, gateway 9/9 against Postgres (`REQUIRE_DB=1`), `scripts/e2e_check.js` 27/27, frontend builds on Vite 8, Docker stack running with YOLO26n (~31–34 ms per frame in the container).
- YOLO26n runs as the raw head + NMS (parity 50/50, max 0.06 px). The NMS-free `--end2end` export is not used: it disagrees on 37/50 images and isn't validated. YOLOv8n backup: `ml/runs/backup-yolov8n-models/` (local, gitignored).
- Local Postgres uses the new `pgdata18` volume; demo history comes from `npm run seed`: real YOLO26n detections on NEU-DET val images, backdated over 7 days (tagged `seed-demo:*`), not production line data.
- Training run, ONNX candidates and logs live in `ml/runs/` (gitignored); results worth keeping are copied to `docs/results/<run>/` (yolo26n shipped; neu-gc10-26n experiment, not shipped).
- GC10-DET is downloaded to `ml/data/gc10-det-raw` and the combined dataset to `ml/data/neu-gc10` (gitignored); its candidate ONNX is in `ml/runs/neu-gc10-26n/onnx/`.
- Long training runs: use a terminal tab and `ml/train.py --resume`; WMI-launched runs were killed silently.

## Pre-merge checks (PR #1, all passed)

- UI: all four pages render after the React 19 / Vite 8 / Router 7 / Recharts 3 upgrade, both Dashboard charts draw with data, no console errors.
- `scripts/e2e_check.js`: 27/27 against the running stack (ALERT_WINDOW 20 and 3).
- Live page: 3.0 fps when the tab is focused (round trip ~61 ms: ~35 ms model, ~26 ms gateway + DB). The earlier ~1 fps was the browser throttling `canvas.toBlob()` in a hidden tab, not an app bug; documented in the README.
- Screenshots retaken against YOLO26n with real inspections only.

- PR #2 `feat/frontend-resilience` (2026-11-10, merged): skeletons, retry/resume, History/Dashboard sync with new inspections, phone layout, zero-filled stats timeline. Checked in the browser (mock API and the real stack); gateway 9/9 against Postgres, `scripts/e2e_check.js` 27/27.

- Branch `upgrade` (`main` + the UI redesign, kept apart from `main` on purpose): Cloudflare-style sidebar layout, icons, floating action button, animated defect background. README screenshots still show the old UI.

## Known issues

- Live sampling drops to ~1–2 fps when the tab is hidden (browser throttles `toBlob`).
- Uploads are stored on local disk; Cloud Run would lose them on restart. `/uploads/*` is served without auth (random UUID names only); the object-storage roadmap item with signed URLs fixes both.
- `scripts/e2e_check.js` isn't in CI yet (needs a Postgres service container).

## Next up

1. Run `scripts/e2e_check.js` in CI with a Postgres service container.
2. Deploy (milestone 8) and replace the 80–120 ms Cloud Run estimate with a measurement.
3. Move uploads to object storage with signed URLs.
4. Per-class confidence thresholds (YOLO26n: crazing peaks at 0.14; inclusion, patches, scratches near 0.52).
5. Optional: validate YOLO26n's NMS-free branch; it might be faster if accurate.

The full idea list is in the README "Roadmap" section; the day-by-day history is in [devlog.md](devlog.md).
