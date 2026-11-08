# Steel Surface Defect Inspection Platform

Real-time computer-vision quality inspection for steel surfaces. A YOLOv8 model (trained on NEU-DET, 6 defect classes) runs behind a FastAPI service, a Node.js gateway handles auth, storage and alerts, and a React dashboard shows live video inspection, history and analytics.

```
React (Vite)  ──REST──►  Node/Express gateway  ──HTTP──►  FastAPI + ONNX Runtime (YOLOv8)
 upload · live video       JWT auth · uploads                 /predict  /health
 history · dashboard       alerts · stats                     CPU or CUDA
                                │
                           PostgreSQL (users, inspections, defects, alerts)
```

**Live video on the web:** the browser plays a video file, samples ~3 frames/sec onto a canvas, sends each to the gateway, and draws the returned boxes on an overlay. Nothing runs on the user's machine except the browser, so it deploys as-is.

**Defect classes:** crazing, inclusion, patches, pitted_surface, rolled-in_scale, scratches.

## Repo layout

| Folder | What it is |
|---|---|
| `ml/` | Data prep, training, ONNX export, latency benchmark, demo-video builder |
| `inference/` | FastAPI + ONNX Runtime service (has a `MOCK_MODE` for development) |
| `gateway/` | Express API: auth, `/api/inspect`, history, stats, alerts, Postgres schema |
| `frontend/` | React dashboard (Dashboard, Live video, Upload, History) |

## Quick start (no model needed yet)

Run the whole stack with fake detections so you can build and demo the UI before training:

```bash
MOCK_MODE=true docker compose up --build
# frontend http://localhost:5173   gateway http://localhost:4000   inference http://localhost:8000/docs
```

Register an account on the login screen, then try Upload and Live video.

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
5. Check the ONNX path matches PyTorch, then benchmark it:
   ```bash
   python parity_check.py --weights runs/neu-det-v1/weights/best.pt
   python benchmark.py --images data/neu-det/images/val          # GPU
   python benchmark.py --images data/neu-det/images/val --cpu    # CPU (what Cloud Run runs)
   ```
6. Build the demo video the Live page plays:
   ```bash
   python make_demo_video.py --images data/neu-det/images/val --out demo_raw.mp4
   ffmpeg -y -i demo_raw.mp4 -c:v libx264 -pix_fmt yuv420p -movflags +faststart ../frontend/public/sample.mp4
   ```

### Results

| Model | mAP@0.5 | mAP@0.5:0.95 | Precision | Recall | CPU latency (ms) | GPU latency (ms) |
|---|---|---|---|---|---|---|
| YOLOv8n | 0.717 | 0.380 | 0.712 | 0.625 | 34.1 | 13.1 |
| YOLOv8s | | | | | | |

Accuracy: NEU-DET validation split (360 images), `best.pt`, conf 0.25 / NMS IoU 0.7. Latency: mean of 200 validation images through the deployed ONNX path (letterbox + inference + NMS), measured with `ml/benchmark.py` (add `--cpu` for the CPU run) on a Ryzen 7 5800H / RTX 3050 Laptop GPU. `ml/parity_check.py` confirms the ONNX path reproduces the PyTorch detections (20/20 images match, max 0.10 px box difference).

Artifacts (metrics, training curves, F1/PR curves, confusion matrix): [`docs/results/yolov8n/`](docs/results/yolov8n/).

**Expected latency on Cloud Run:** 2 vCPUs is far fewer cores than the 8-core benchmark machine, and ONNX Runtime scales with cores, so budget roughly **80–120 ms** per frame there instead of 34 ms (an estimate, not yet measured). The Live page is designed for this: it sends at most one frame at a time and skips ticks while a request is in flight instead of queueing them. It keeps the full 3 fps while a round trip (gateway + inference + DB) stays under ~333 ms, and drops to ~1.5 fps instead of falling behind when it doesn't.

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
5. Put `sample.mp4` in `frontend/public/` before building so "Load sample" works for visitors.

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
