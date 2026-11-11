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

## 2026-11-11

**Did**
- Pre-deploy checks on `main` (4fc207e) in a separate production-mode Compose stack (`NODE_ENV=production`, random `JWT_SECRET`, frontend on its own origin): dependency audits clean, e2e 27/27, cross-origin browser check, CORS, error responses, security headers, upload size limit.
- Measured containers: inference ~175 MiB and ~1.5 s to ready, gateway ~46 MiB and ~1.2 s; images 669 / 262 / 96 MB.
- Fixed what the checks found (branch `fix/predeploy-hardening`): DB TLS certificate now verified, inference deps pinned, undecodable images get 400 instead of 502 with internal detail, `ALLOW_REGISTRATION` switch. Gateway 11 pass + 2 DB-only skips locally, inference 8/8 on the pinned image, e2e 27/27.

**Decided**
- `DB_SSL=true` means verified TLS; `no-verify` is opt-in for providers with a private CA.
- Inference on Cloud Run gets 512 MiB, not 1 GiB (measured usage is ~175 MiB).
- Pin the inference Python deps exactly; bump them on purpose with tests, parity check and e2e.

**Open / blocked**
- PRs #5/#6 (history API and page) are open; rerun e2e after they merge.
- Deployment plan drafted (Neon + Cloud Run + Vercel), paused.

**Next**
- Merge the hardening PR, settle #5/#6, then deploy.

## 2026-11-10

**Did**
- Frontend resilience pass on `feat/frontend-resilience`: first-load skeletons (Dashboard, History), spinner overlay on Upload, Retry on Upload/Dashboard/History, Live pauses after 3 failed frames with Resume, 401 vs retryable errors (`ApiError`).
- New `useLiveQuery` hook: first-load vs background refresh tracked separately, throttled (4 s) non-overlapping refetch on poll, focus and the new-inspection signal.
- Fixed horizontal overflow at phone width; History is cards below 640 px; KPI tiles in 2 columns; horizontal bar chart.
- `/api/stats` timeline zero-filled with `generate_series`, plus a Postgres-backed gateway test; CI gateway job gets a Postgres service.
- Checked in the browser against an in-memory mock API (Docker was off and training was using the RAM, 1.9 GB free): no overflow on any page at 360/390/414 px; 0 skeletons during three 10 s polls; skeleton layout matches real content (Dashboard exact, History rows within 3 px); an Upload in one tab showed up in History open in another tab; 27 signals in 9 s gave 4 History fetches; Live paused after exactly 3 failed calls and Resume restarted it; 401 signed out with no Retry.
- After training finished (run `neu-gc10-26n` stopped at epoch 78/100), started the stack with the real model: gateway tests 9/9 against Postgres with `REQUIRE_DB=1` (both zero-fill tests fail on the old `date_trunc` query, pass on the new one); `scripts/e2e_check.js` 27/27; Dashboard on the seeded data at 390 px, no overflow, today's empty bucket plotted as 0.
- Checked 11 user-supplied images (`images_train/`): unlabeled stock metal-texture photos, three with stock-site watermarks. The shipped model flagged diamond-plate and galvanized textures as defects and missed fine scratches on bright metal (domain shift). Deleted them at the user's request.
- Downloaded GC10-DET from Hugging Face (`lzhzj/gc10-det`, 2,294 images, CC BY 4.0 per the Roboflow mirror) into `ml/data/` and built a 16-class NEU-DET + GC10-DET dataset (`ml/prepare_combined.py`).
- Trained a combined YOLO26n (early stop at epoch 78). NEU-DET: mAP@0.5 0.747 vs 0.739 shipped, mAP@0.5:0.95 0.395 vs 0.404; GC10-DET test 0.689; parity 50/50; CPU p50 32.6 vs 30.3 ms.
- Recorded the experiment as PR #3 and merged it (5c98614). That conflicted PR #2 on the shared docs (CHANGELOG, devlog); PR #2's session merged `main` in (44797fc), CI green again, then PR #2 merged too. CHANGELOG now has dated sections for both.

**Did (later)**
- Inspection history API: Live frames with a defect now keep their image (`SAVE_VIDEO_FRAMES`, default `defects`); `GET`/`DELETE /api/inspections/:id`; `GET /api/inspections/export.csv`; `from`/`to` filters; `npm run cleanup-uploads`. Gateway tests 14/14 inside the container against Postgres (`REQUIRE_DB=1`). End to end against the running stack: 6 real video frames with defects stored with images, get 200, delete 204, CSV download OK; test rows deleted afterwards. Cleanup dry-run: 124 of 160 files on disk are orphaned (1.8 MB), not deleted yet.
- Inspection history UI on `feat/history-ui` (frontend only, against the new gateway history API): From/To date filters, Export CSV, `/history/:id` detail dialog with image and boxes, delete with a confirmation step, thumbnails for video frames, Live note. Checked in the browser against the running stack: To=today included today's 48 rows, To=yesterday gave 120, none gave 168; export with Result=fail returned 168 rows; a stubbed truncated export showed the note, a stubbed 503 showed Retry; detail opened from a row click and its # link, Esc closed it back to the list with filters kept; a direct URL to a deleted id showed "not found" with no Retry; deleting a test upload removed the row (169 → 168), made the image and detail 404, and the Dashboard open in another tab refetched 60 ms later; no horizontal overflow at 360 px for the list or the dialog. Both test inspections were deleted afterwards.

**Decided**
- Video frames keep their image only when the model finds a defect: those are the ones worth reviewing, and ~3 fps of passing frames would fill the disk.
- Upload cleanup is a CLI script, not an API route: files are shared across users and every route is user-scoped.
- History detail is a dialog on the optional route `/history/:id?`, not a separate page: the list stays mounted under it, so filters, page and scroll survive, a deleted row can vanish immediately, and the detail still has its own link.
- Delete asks in place (Delete → "This can't be undone" → Delete / Cancel) rather than through `window.confirm`, so the prompt names what goes (the row and its stored image).
- The new-inspection signal is also broadcast to other tabs (BroadcastChannel). Only one page is mounted per tab, so an in-tab context alone would almost never reach an "already open" History page.
- History on phones: cards rather than a horizontally scrolling table.
- Recharts animations off on the Dashboard so a poll with new numbers doesn't replay the draw-in.
- Keep the shipped NEU-only YOLO26n: the NEU-DET difference is within noise, scratches got worse, and the app doesn't need GC10's classes yet.
- Don't launch training through WMI (`Win32_Process.Create`): three runs died silently with the whole process tree after 5–40 minutes, likely WMI's 512 MB provider-host memory quota. Run long jobs in a terminal tab instead, with `train.py --resume` for interruptions.

**Open / blocked**
- GC10's sheet inclusion (0.30) and rolled pit (0.24) are weak; crease and waist fold have 1–2 test boxes, so their scores are meaningless.

**Next**
- Review and merge PR #4 (UI redesign); it was built on PR #2's branch, so check it against the new `main`.
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
