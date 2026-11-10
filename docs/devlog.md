# Dev log

One entry per working day, newest first. What we did, what we decided and why, what's blocked, and what's next.
This is the running diary; [CHANGELOG.md](../CHANGELOG.md) lists what shipped, and [project-status.md](project-status.md) is the current snapshot.

Template:

```
## YYYY-MM-DD
**Did**
- ...
**Decided**
- ... (why)
**Open / blocked**
- ...
**Next**
- ...
```

---

## 2026-11-10

**Did**
- Checked 11 user-supplied images (`images_train/`): unlabeled stock metal-texture photos, three with stock-site watermarks. The shipped model flagged diamond-plate and galvanized textures as defects and missed fine scratches on bright metal (domain shift). Deleted them at the user's request.
- Downloaded GC10-DET from Hugging Face (`lzhzj/gc10-det`, 2,294 images, CC BY 4.0 per the Roboflow mirror) into `ml/data/` and built a 16-class NEU-DET + GC10-DET dataset (`ml/prepare_combined.py`).
- Trained a combined YOLO26n (early stop at epoch 78). NEU-DET: mAP@0.5 0.747 vs 0.739 shipped, mAP@0.5:0.95 0.395 vs 0.404; GC10-DET test 0.689; parity 50/50; CPU p50 32.6 vs 30.3 ms.

**Decided**
- Keep the shipped NEU-only YOLO26n: the NEU-DET difference is within noise, scratches got worse, and the app doesn't need GC10's classes yet.
- Don't launch training through WMI (`Win32_Process.Create`): three runs died silently with the whole process tree after 5–40 minutes, likely WMI's 512 MB provider-host memory quota. Run long jobs in a terminal tab instead, with `train.py --resume` for interruptions.

**Open / blocked**
- GC10's sheet inclusion (0.30) and rolled pit (0.24) are weak; crease and waist fold have 1–2 test boxes, so their scores are meaningless.

**Next**
- Deployment, unless GC10 classes become a requirement.

## 2026-11-09

**Did**
- Researched a Claude Code workflow video ("Plan, Setup, Build") and applied its setup checklist here: `CLAUDE.md`, `docs/architecture.md`, `docs/project-status.md`, `CHANGELOG.md`, root `.env.example`.
- Branch `chore/claude-code-setup`: 6 commits (Node 24 runtime, project docs, stack upgrade, seed, YOLO26n, docs), pushed as PR #1 against `main` (https://github.com/Ayushman2804/vision-inspection/pull/1). CI green on all 4 jobs; Auto-fix on.
- Added this devlog.
- Ran the full stack locally and walked through it as a user: register, Live video with the sample clip, Dashboard, History. All worked with the real YOLOv8n model.
- Upgraded the stack: React 19, Vite 8, React Router 7, Recharts 3, Express 5, Python 3.13, FastAPI 0.162, ONNX Runtime 1.31, PostgreSQL 18, nginx 1.30.6. Tests: inference 8/8, gateway 7/7; frontend builds; checked in the browser.
- Frontend pages lazy-loaded (initial JS 675 kB → 264 kB); restored legend order after Recharts 3 changed it.
- Inference now decodes YOLO26's NMS-free output as well as YOLOv8's.
- Added `npm run seed` for mock demo history (tagged `seed-demo`).
- Trained YOLO26n on NEU-DET (local RTX 3050, same settings as YOLOv8n), watched it with the new `ml/monitor.html`, then parity-checked, benchmarked and deployed it.

**Decided**
- Use React Router 7, not the newer 8, to match the agreed upgrade list.
- YOLO26n replaces YOLOv8n only if mAP@0.5 is at most 0.01 lower and CPU latency improves.
- Postgres 18 uses a new `pgdata18` volume; the old local Postgres 16 data is left untouched rather than migrated (local dev data only).
- Mock data stays clearly tagged and is never shown as real model results.
- **YOLO26n ships.** Training finished (100 epochs, ~50 min): mAP@0.5 0.739 vs 0.717, mAP@0.5:0.95 0.404 vs 0.380, better AP@0.5 on all classes, CPU p50 31 vs 36 ms. Clears the swap rule.
- Deploy the raw head + NMS, not the NMS-free `--end2end` export: the end2end branch disagreed with PyTorch on 37/50 images, while the raw export matched 50/50 (max 0.06 px). The checkpoint validates through the raw head, so that's what the 0.739 describes.
- Seeded demo history stays real model output (no fabricated rows); timestamps are the only synthetic part, and the README says so. NEU-DET has no clean images, so the seeded defect rate is 100%.
- `/uploads/*` access control goes into the object-storage roadmap item (signed URLs) rather than its own entry.
- The "~2× faster on CPU" claim from the upgrade table wasn't reproduced: ~13% here, because we still run NMS like YOLOv8n.

- Pre-merge checks for PR #1: clicked through all four pages after the frontend upgrade (charts render, no console errors); wrote `scripts/e2e_check.js` (27/27 against the running stack, also with ALERT_WINDOW=3); measured the Live page at 3.0 fps when focused; retook all five screenshots with YOLO26n and real data only.
- Merged PR #1 (56cbd64) after the pre-merge checks.
- Reworked `npm run seed` to use real model output: 120 NEU-DET val images posted through the API (26 uploads, 94 video, 307 YOLO26n detections), then backdated over 7 days with uneven daily volume (9-30 per day). Retook the Dashboard and History screenshots on it.
- Found the "1 fps" cause: in a hidden tab the browser throttles `canvas.toBlob()` to ~1 s per call (the 333 ms timer itself still fires on time). Not an app bug; README now says to keep the Live tab in the foreground.

**Open / blocked**
- `/uploads/*` is served without auth (UUID filenames only); worth revisiting with object storage.
- A first validation run hung in Windows dataloader workers; rerunning with `workers=0` fixed it (note for future `model.val` calls on Windows).

**Next**
- Merge PR #1.
- Check the Live frame rate in a normal browser, retake screenshots, then plan deployment.

## 2026-11-08

**Did**
- Initial platform: FastAPI + ONNX inference, Express gateway with JWT, Postgres and alerts, React dashboard, ML scripts, CI.
- Trained YOLOv8n and YOLOv8s on NEU-DET; exported, parity-checked and benchmarked both.
- Shipped YOLOv8n; added demo video and screenshots.

**Decided**
- YOLOv8n over YOLOv8s: +0.016 mAP@0.5 wasn't worth 2.75× the CPU latency (threshold set in advance: +0.03).
- Default confidence 0.25 to favour recall.
- `MOCK_MODE` takes precedence over the committed model file.

**Next**
- Stack review and deployment planning.
