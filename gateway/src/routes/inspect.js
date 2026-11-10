import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { evaluateAlert } from '../services/alerts.js';
import { runInference } from '../services/inference.js';
import { HttpError, clamp, toCsv } from '../utils.js';

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const EXPORT_MAX_ROWS = 50_000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) =>
    EXT[file.mimetype] ? cb(null, true) : cb(new HttpError(415, 'Only JPEG, PNG or WebP images are allowed')),
});

const router = Router();

/** Manual uploads always keep their image; video frames follow SAVE_VIDEO_FRAMES (none | defects | all). */
export function shouldStoreImage(source, defectCount, mode = config.saveVideoFrames) {
  if (source === 'upload') return true;
  if (mode === 'all') return true;
  return mode === 'defects' && defectCount > 0;
}

/** Removes a stored image given its public `/uploads/<name>` path. Missing files are fine. */
async function removeImage(imageUrl) {
  if (!imageUrl) return;
  await fs.rm(path.join(config.uploadDir, path.basename(imageUrl)), { force: true });
}

router.post(
  '/inspect',
  requireAuth,
  upload.single('image'),
  async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Missing image file (form field "image")');
    const conf = clamp(req.body.conf, 0.05, 0.95, 0.25);
    const source = req.body.source === 'video' ? 'video' : 'upload';

    const result = await runInference(req.file.buffer, req.file.mimetype, conf);
    const detections = result.detections || [];

    let imageUrl = null;
    if (shouldStoreImage(source, detections.length)) {
      const name = `${crypto.randomUUID()}${EXT[req.file.mimetype]}`;
      await fs.mkdir(config.uploadDir, { recursive: true });
      await fs.writeFile(path.join(config.uploadDir, name), req.file.buffer);
      imageUrl = `/uploads/${name}`;
    }

    const status = detections.length > 0 ? 'fail' : 'pass';
    const client = await pool.connect();
    let inspection;
    try {
      await client.query('BEGIN');
      const ins = await client.query(
        `INSERT INTO inspections (user_id, source, image_path, status, defect_count, latency_ms, model_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, source, status, defect_count, latency_ms, model_version, created_at`,
        [req.user.id, source, imageUrl, status, detections.length, result.latency_ms, result.model_version],
      );
      inspection = { ...ins.rows[0], image_url: imageUrl };
      for (const d of detections) {
        await client.query(
          `INSERT INTO defects (inspection_id, class_name, confidence, bbox, area_pct)
           VALUES ($1, $2, $3, $4, $5)`,
          [inspection.id, d.class_name, d.confidence, JSON.stringify(d.bbox), d.area_pct],
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      await removeImage(imageUrl); // don't leave an orphaned file behind
      throw e;
    } finally {
      client.release();
    }

    const alert = await evaluateAlert(req.user.id);
    res.status(201).json({ inspection, detections, image: result.image, alert });
  },
);

/** WHERE clause for the history filters (status, source, class, from, to). Always scoped to the user. */
function historyFilter(req) {
  const where = ['i.user_id = $1'];
  const params = [req.user.id];
  const q = req.query;

  if (['pass', 'fail'].includes(q.status)) {
    params.push(q.status);
    where.push(`i.status = $${params.length}`);
  }
  if (['upload', 'video'].includes(q.source)) {
    params.push(q.source);
    where.push(`i.source = $${params.length}`);
  }
  if (q.class) {
    params.push(String(q.class));
    where.push(
      `EXISTS (SELECT 1 FROM defects dc WHERE dc.inspection_id = i.id AND dc.class_name = $${params.length})`,
    );
  }
  for (const [key, op] of [['from', '>='], ['to', '<']]) {
    if (!q[key]) continue;
    const t = new Date(String(q[key]));
    if (Number.isNaN(t.getTime())) throw new HttpError(400, `Invalid "${key}" date`);
    params.push(t.toISOString());
    where.push(`i.created_at ${op} $${params.length}`);
  }
  return { clause: where.join(' AND '), params };
}

const SELECT_WITH_DEFECTS = `
  SELECT i.id, i.source, i.image_path AS image_url, i.status, i.defect_count, i.latency_ms,
         i.model_version, i.created_at,
         COALESCE(json_agg(json_build_object('class_name', d.class_name, 'confidence', d.confidence,
                                             'bbox', d.bbox, 'area_pct', d.area_pct)
                           ORDER BY d.confidence DESC)
                  FILTER (WHERE d.id IS NOT NULL), '[]') AS defects
  FROM inspections i
  LEFT JOIN defects d ON d.inspection_id = i.id`;

router.get(
  '/inspections',
  requireAuth,
  async (req, res) => {
    const limit = clamp(req.query.limit, 1, 100, 20);
    const offset = clamp(req.query.offset, 0, 1_000_000, 0);
    const { clause, params } = historyFilter(req);

    const total = await pool.query(`SELECT count(*)::int AS n FROM inspections i WHERE ${clause}`, params);
    const { rows } = await pool.query(
      `${SELECT_WITH_DEFECTS}
       WHERE ${clause}
       GROUP BY i.id
       ORDER BY i.id DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    res.json({ total: total.rows[0].n, limit, offset, items: rows });
  },
);

// Registered before /inspections/:id so "export.csv" is not taken for an id.
router.get(
  '/inspections/export.csv',
  requireAuth,
  async (req, res) => {
    const { clause, params } = historyFilter(req);
    const { rows } = await pool.query(
      `SELECT i.id, i.created_at, i.source, i.status, i.defect_count, i.latency_ms, i.model_version,
              i.image_path AS image_url,
              COALESCE(string_agg(d.class_name || ':' || d.n, ';' ORDER BY d.class_name), '') AS defect_classes,
              max(d.max_conf) AS max_confidence
       FROM inspections i
       LEFT JOIN (SELECT inspection_id, class_name, count(*) AS n, max(confidence) AS max_conf
                  FROM defects GROUP BY inspection_id, class_name) d ON d.inspection_id = i.id
       WHERE ${clause}
       GROUP BY i.id
       ORDER BY i.id DESC
       LIMIT ${EXPORT_MAX_ROWS + 1}`,
      params,
    );
    const truncated = rows.length > EXPORT_MAX_ROWS;
    const columns = [
      'id', 'created_at', 'source', 'status', 'defect_count', 'latency_ms', 'model_version',
      'image_url', 'defect_classes', 'max_confidence',
    ];
    const stamp = new Date().toISOString().slice(0, 10);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="inspections-${stamp}.csv"`,
      'X-Total-Rows': String(Math.min(rows.length, EXPORT_MAX_ROWS)),
      'X-Truncated': String(truncated),
      'Access-Control-Expose-Headers': 'Content-Disposition, X-Total-Rows, X-Truncated',
    });
    res.send(toCsv(columns, rows.slice(0, EXPORT_MAX_ROWS)));
  },
);

function parseId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1 || id > 2_147_483_647) throw new HttpError(400, 'Invalid inspection id');
  return id;
}

router.get(
  '/inspections/:id',
  requireAuth,
  async (req, res) => {
    const id = parseId(req.params.id);
    const { rows } = await pool.query(
      `${SELECT_WITH_DEFECTS}
       WHERE i.id = $1 AND i.user_id = $2
       GROUP BY i.id`,
      [id, req.user.id],
    );
    if (!rows.length) throw new HttpError(404, 'Inspection not found');
    res.json(rows[0]);
  },
);

router.delete(
  '/inspections/:id',
  requireAuth,
  async (req, res) => {
    const id = parseId(req.params.id);
    // Defects go with it (ON DELETE CASCADE).
    const { rows } = await pool.query(
      'DELETE FROM inspections WHERE id = $1 AND user_id = $2 RETURNING image_path',
      [id, req.user.id],
    );
    if (!rows.length) throw new HttpError(404, 'Inspection not found');
    await removeImage(rows[0].image_path);
    res.status(204).end();
  },
);

export default router;
