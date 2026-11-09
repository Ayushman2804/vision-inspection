# Steel Surface Defect Inspection Platform

Real-time computer-vision quality inspection for steel surfaces. A YOLOv8 model (trained on NEU-DET, 6 defect classes) runs behind a FastAPI service, a Node.js gateway handles auth, storage and alerts, and a React dashboard shows live video inspection, history and analytics.

```
React (Vite)  ──REST──►  Node/Express gateway  ──HTTP──►  FastAPI + ONNX Runtime (YOLOv8)
 upload · live video       JWT auth · uploads                 /predict  /health
 history · dashboard       alerts · stats                     CPU or CUDA
                                │
                           PostgreSQL (users, inspections, defects, alerts)
```

## Screenshots

All captured against the shipped YOLOv8n model on NEU-DET validation images (not mock mode).

![Dashboard](docs/screenshots/dashboard.png)
*Dashboard: KPIs, defects by class, throughput, and the defect-rate alert firing.*

![Live video inspection](docs/screenshots/live.png)
*Live video: frames sampled in the browser at 3 fps, with detections drawn on the overlay (~35 ms per frame on CPU).*

| Upload | History |
|---|---|
| ![Upload result](docs/screenshots/upload.png) | ![Inspection history](docs/screenshots/history.png) |
| *Single-image inspection with verdict and detections table* | *Filterable history with per-defect chips* |

**Live video on the web:** the browser plays a video file, samples ~3 frames/sec onto a canvas, sends each to the gateway, and draws the returned boxes on an overlay. Nothing runs on the user's machine except the browser, so it deploys as-is.

**Defect classes:** crazing, inclusion, patches, pitted_surface, rolled-in_scale, scratches.

## Repo layout

| Folder | What it is |
|---|---|
| `ml/` | Data prep, training, ONNX export, latency benchmark, demo-video builder |
| `inference/` | FastAPI + ONNX Runtime service (has a `MOCK_MODE` for development) |
| `gateway/` | Express API: auth, `/api/inspect`, history, stats, alerts, Postgres schema |
| `frontend/` | React dashboard (Dashboard, Live video, Upload, History) |

Developer docs: [`docs/architecture.md`](docs/architecture.md) (request flow, schema, env vars), [`docs/project-status.md`](docs/project-status.md), [`CHANGELOG.md`](CHANGELOG.md). [`CLAUDE.md`](CLAUDE.md) holds the conventions for working on the repo with Claude Code.

## Quick start

The trained YOLOv8n model (`inference/models/best.onnx`) is in the repo, so the whole stack runs with real detections out of the box:

```bash
docker compose up --build
# frontend http://localhost:5173   gateway http://localhost:4000   inference http://localhost:8000/docs
```

Register an account on the login screen, then try Upload and Live video ("Load sample" plays a clip built from NEU-DET validation images).

For UI work without the model, `MOCK_MODE=true docker compose up --build` returns random boxes instead. `MOCK_MODE` takes precedence over the model file. To keep overrides (`JWT_SECRET`, `MOCK_MODE`, `MODEL_VERSION`) between runs, copy `.env.example` to `.env`; Compose reads it automatically.

## Step 1: train the model (local GPU)

```bash
cd ml
python -m venv .venv && source .venv/bin/activate
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121   # match your CUDA version
pip install -r requirements.txt
python -c "import torch; print(torch.cuda.is_available())"                          # must print True
```

1. Download NEU-DET (search "NEU surface defect database" on Kaggle or the original NEU site) and unzip it.
2. Convert to YOLO format. This keeps the dataset's own split (1,440 train / 360 val, 60 val images per class) so results are comparable with published NEU-DET numbers; `--resplit` builds a new split stratified by class instead:
   ```bash
   python prepare_neu_det.py --src /path/to/NEU-DET --out data/neu-det
   ```
3. Train (start with the nano model, then compare against `yolov8s.pt`):
   ```bash
   python train.py --data data/neu-det/data.yaml --model yolov8n.pt --epochs 100
   ```
   Metrics land in `runs/<name>/metrics_summary.json` (mAP@0.5, mAP@0.5:0.95, precision, recall, per-class AP).
4. Export to ONNX and install into the inference service:
   ```bash
   python export_onnx.py --weights runs/neu-det-v1/weights/best.pt --version yolov8n-neu-det-v1
   ```
   This overwrites the deployed `inference/models/`. To evaluate a candidate without touching it, add `--out-dir runs/<name>/onnx` and point `benchmark.py` / `parity_check.py` at it with `--model`/`--onnx` and `--labels`.
5. Check the ONNX path matches PyTorch, then benchmark it:
   ```bash
   python parity_check.py --weights runs/neu-det-v1/weights/best.pt
   python benchmark.py --images data/neu-det/images/val          # GPU
   python benchmark.py --images data/neu-det/images/val --cpu    # CPU (what Cloud Run runs)
   ```
6. Build the demo video the Live page plays:
   ```bash
   python make_demo_video.py --images data/neu-det/images/val --out demo_raw.mp4
   ffmpeg -y -i demo_raw.mp4 -c:v libx264 -preset veryfast -pix_fmt yuv420p -movflags +faststart ../frontend/public/sample.mp4
   ```

### Results

| Model | Params | mAP@0.5 | mAP@0.5:0.95 | Precision | Recall | CPU latency p50 / mean (ms) | GPU latency p50 / mean (ms) |
|---|---|---|---|---|---|---|---|
| **YOLOv8n (shipped)** | 3.1 M | 0.717 | 0.380 | 0.712 | 0.625 | 29.0 / 29.7 | 9.6 / 10.4 |
| YOLOv8s | 11.1 M | 0.733 | 0.380 | 0.624 | 0.704 | 79.8 / 81.1 | 16.6 / 16.7 |

Accuracy: NEU-DET validation split (360 images), `best.pt`, standard Ultralytics validation (NMS IoU 0.7). Precision and recall are at the confidence that maximises mean F1, not at the app's 0.25 default. Both models were trained with identical settings (640 px, batch 8, seed 42, up to 100 epochs). Latency: 200 validation images through the deployed ONNX path (letterbox + inference + NMS), measured with `ml/benchmark.py` (add `--cpu` for the CPU run) on a Ryzen 7 5800H / RTX 3050 Laptop GPU, with both models benchmarked back to back in the same session. `ml/parity_check.py` confirms the ONNX path reproduces the PyTorch detections (YOLOv8n: 20/20 images match, max 0.10 px box difference).

Per-class AP@0.5 (AP@0.5:0.95 in brackets):

| Class | YOLOv8n | YOLOv8s | Change |
|---|---|---|---|
| crazing | 0.484 (0.205) | 0.497 (0.184) | +0.013 (−0.021) |
| inclusion | 0.781 (0.422) | 0.821 (0.430) | +0.040 (+0.008) |
| patches | 0.908 (0.595) | 0.905 (0.576) | −0.003 (−0.019) |
| pitted_surface | 0.773 (0.413) | 0.802 (0.435) | +0.029 (+0.022) |
| rolled-in_scale | 0.541 (0.217) | 0.558 (0.247) | +0.017 (+0.030) |
| scratches | 0.816 (0.427) | 0.813 (0.410) | −0.003 (−0.017) |

Artifacts (metrics, training curves, F1/PR curves, confusion matrix): [`docs/results/yolov8n/`](docs/results/yolov8n/), [`docs/results/yolov8s/`](docs/results/yolov8s/).

### Model choice: why YOLOv8n ships

We trained YOLOv8s (3.5× the parameters) to test whether model capacity was the bottleneck. It isn't, so the smaller model ships.

- **The accuracy gain is small.** mAP@0.5 rises by only +0.016, below the 0.03 we set in advance as the minimum worth paying for. mAP@0.5:0.95 is unchanged (0.380 vs 0.380).
- **It finds more defects but doesn't localise them better.** YOLOv8s trades precision for recall (P 0.712 → 0.624, R 0.625 → 0.704), while box quality is flat. For inspection, a box that lands in the wrong place on the strip is not an improvement.
- **The recall gain comes mostly from a different operating point.** F1 from the reported P/R is 0.666 for YOLOv8n vs 0.661 for YOLOv8s. The apparent recall jump comes from where Ultralytics happens to report P/R on each model's curve. YOLOv8n reaches the same recall (0.70) by lowering its confidence threshold, and it already does at the app's default of 0.25: P 0.605 / R 0.702. Compared at that same 0.70 recall, YOLOv8s is only slightly more precise (0.631 vs 0.608, F1 0.652 vs 0.644). That small edge, which matches the +0.016 mAP, isn't worth 80 ms instead of 29 ms per image.
- **The weak classes stay weak.** crazing (+0.013) and rolled-in_scale (+0.017) barely move. crazing's AP@0.5:0.95 even drops. This fits the earlier diagnosis that these classes are limited by loose NEU-DET boxes, not by model size, so the next accuracy gain should come from tightening those labels.
- **It costs 2.75× the CPU time.** CPU p50 is 79.8 ms vs 29.0 ms. Cloud Run's 2 vCPUs should be about 2–3× slower than this laptop, which would put YOLOv8s around 160–240 ms per frame. That uses most of the Live page's ~333 ms per-frame budget, for a model that is no better at placing boxes.

**Expected latency on Cloud Run:** 2 vCPUs is far fewer cores than the 8-core benchmark machine, and ONNX Runtime scales with cores, so budget roughly **80–120 ms** per frame there instead of ~30 ms (an estimate, not yet measured). The Live page is designed for this: it sends at most one frame at a time and skips ticks while a request is in flight instead of queueing them. It keeps the full 3 fps while a round trip (gateway + inference + DB) stays under ~333 ms, and drops to ~1.5 fps instead of falling behind when it doesn't.

### Confidence threshold

The default confidence threshold is **0.25** (Upload and Live sliders, and the gateway fallback).

- Peak F1 across all classes is **0.65 at 0.372**, but the curve is nearly flat from **0.22 to 0.40** (F1 0.64–0.65), so moving up to 0.372 barely changes the overall score.
- `crazing` and `rolled-in_scale` peak near **0.20** and lose recall above it.
- 0.25 is chosen to favour recall: in inspection, a missed defect costs more than a false alarm.

Source: [`docs/results/yolov8n/BoxF1_curve.png`](docs/results/yolov8n/BoxF1_curve.png) (YOLOv8n, `best.pt`, NEU-DET validation split).

## Step 2: run locally without Docker

```bash
# 1. Postgres
docker run -d --name inspection-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=inspection -p 5432:5432 postgres:16-alpine

# 2. Inference (uses inference/models/best.onnx, or MOCK_MODE=true)
cd inference && pip install -r requirements.txt && uvicorn app.main:app --port 8000

# 3. Gateway
cd gateway && cp .env.example .env && npm install && npm run dev

# 4. Frontend
cd frontend && cp .env.example .env && npm install && npm run dev
```

The gateway creates its tables automatically on startup (`gateway/db/init.sql`).

## API (gateway)

| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/register`, `/api/auth/login` | Returns a JWT (12 h) |
| POST | `/api/inspect` | multipart: `image`, `conf` (0.05–0.95), `source` (`upload`/`video`) |
| GET | `/api/inspections` | Filters: `status`, `class`, `source`; paging: `limit`, `offset` |
| GET | `/api/stats?days=7` | Totals, defects by class, timeline |
| GET | `/api/alerts` | Recent alerts |
| GET | `/api/health` | DB check |

**Alert rule:** when at least `ALERT_THRESHOLD` (default 50%) of the last `ALERT_WINDOW` (default 20) inspections failed, an alert is stored and returned with the inspect response (60 s cooldown).

## Step 3: deploy

Free tiers sleep after inactivity, so the first request can be slow (cold start). Mention it in your demo notes.

1. **Database:** create a free Postgres on [Neon](https://neon.tech) or Supabase. Copy the connection string.
2. **Inference** (Google Cloud Run; commit `inference/models/best.onnx` first, the nano model is small):
   ```bash
   gcloud run deploy inspection-inference --source inference --region asia-south1 \
     --memory 1Gi --cpu 2 --allow-unauthenticated \
     --set-env-vars MODEL_VERSION=yolov8n-neu-det-v1
   ```
   Better: deploy it as private (no `--allow-unauthenticated`) and let only the gateway call it.
3. **Gateway** (Cloud Run, Render or Railway):
   ```bash
   gcloud run deploy inspection-gateway --source gateway --region asia-south1 --allow-unauthenticated \
     --set-env-vars NODE_ENV=production,DB_SSL=true,JWT_SECRET=<long-random>,\
   DATABASE_URL=<neon-url>,INFERENCE_URL=<inference-url>,CORS_ORIGINS=<frontend-url>
   ```
   `UPLOAD_DIR` is local disk, which is ephemeral on Cloud Run. Uploaded originals disappear on restart; video frames are never stored. Move uploads to GCS or Cloudflare R2 when you improve this.
4. **Frontend** (Vercel or Netlify): import the repo, set the root to `frontend`, and add `VITE_API_URL=<gateway-url>`. `frontend/vercel.json` handles client-side routing. Add the frontend URL to the gateway's `CORS_ORIGINS`.
5. `frontend/public/sample.mp4` (committed, built from NEU-DET validation images) ships with the build, so "Load sample" works for visitors.

## Tests and CI

```bash
cd inference && pytest        # letterbox, NMS, post-processing, API (mock mode)
cd gateway && npm test        # alert rule
cd frontend && npm run build
```

GitHub Actions (`.github/workflows/ci.yml`) runs all three and a `docker compose build`.

## Roadmap (improvements for later)

- Human review queue: confirm or reject detections and export corrections as retraining data (`defects.reviewed` / `review_label` columns already exist)
- WebSocket push for alerts and a true stream endpoint
- Email or Slack alert delivery
- Anomaly-detection mode (PatchCore via `anomalib`) for unseen defect types
- Object storage for uploads, model registry and versioned rollouts, Prometheus metrics
- Model comparison page (YOLOv8n vs YOLOv8s)
- Per-class confidence thresholds instead of one global value: low for `crazing` and `rolled-in_scale` (their F1 peaks near 0.20), higher for `patches`
