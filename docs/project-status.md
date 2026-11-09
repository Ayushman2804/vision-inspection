# Project status

Last updated: 2026-11-09

## Milestones

| # | Milestone | Status |
|---|---|---|
| 1 | Full stack running end to end (inference, gateway, Postgres, dashboard) with mock detector | Done |
| 2 | Train YOLOv8n on NEU-DET, export to ONNX, verify parity, benchmark | Done (mAP@0.5 0.717, CPU p50 29 ms) |
| 3 | Compare YOLOv8s and choose the shipped model | Done: YOLOv8n ships (see README "Model choice") |
| 4 | Real-model demo video and screenshots | Done |
| 5 | Deploy (Neon + Cloud Run + Vercel) and measure real Cloud Run latency | Not started |
| 6 | Human review queue and retraining export | Not started |

## Where things stand

- `main` has the YOLOv8n model, results and screenshots.
- Branch `chore/claude-code-setup` (not merged): Node 24 Docker images and gateway `engines` `>=22` to match CI; CLAUDE.md, docs (this file, architecture, changelog), root `.env.example`.

## Next up

1. Deploy (milestone 5) and replace the 80–120 ms Cloud Run estimate in the README with a measurement.
2. Move uploads to object storage (GCS or R2) before relying on the deployed history.
3. Per-class confidence thresholds (low for crazing and rolled-in_scale).
4. Review queue using the existing `defects.reviewed` / `review_label` columns.

The full idea list is in the README "Roadmap" section.
