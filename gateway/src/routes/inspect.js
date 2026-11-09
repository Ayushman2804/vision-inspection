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
import { HttpError, clamp } from '../utils.js';

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) =>
    EXT[file.mimetype] ? cb(null, true) : cb(new HttpError(415, 'Only JPEG, PNG or WebP images are allowed')),
});

const router = Router();

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

    // Keep originals only for manual uploads; sampled video frames would flood storage.
    let imageUrl = null;
    if (source === 'upload') {
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
      throw e;
    } finally {
      client.release();
    }

    const alert = await evaluateAlert(req.user.id);
    res.status(201).json({ inspection, detections, image: result.image, alert });
  },
);

router.get(
  '/inspections',
  requireAuth,
  async (req, res) => {
    const limit = clamp(req.query.limit, 1, 100, 20);
    const offset = clamp(req.query.offset, 0, 1_000_000, 0);
    const where = ['i.user_id = $1'];
    const params = [req.user.id];

    if (['pass', 'fail'].includes(req.query.status)) {
      params.push(req.query.status);
      where.push(`i.status = $${params.length}`);
    }
    if (['upload', 'video'].includes(req.query.source)) {
      params.push(req.query.source);
      where.push(`i.source = $${params.length}`);
    }
    if (req.query.class) {
      params.push(String(req.query.class));
      where.push(
        `EXISTS (SELECT 1 FROM defects dc WHERE dc.inspection_id = i.id AND dc.class_name = $${params.length})`,
      );
    }
    const clause = where.join(' AND ');

    const total = await pool.query(`SELECT count(*)::int AS n FROM inspections i WHERE ${clause}`, params);
    const { rows } = await pool.query(
      `SELECT i.id, i.source, i.image_path AS image_url, i.status, i.defect_count, i.latency_ms,
              i.model_version, i.created_at,
              COALESCE(json_agg(json_build_object('class_name', d.class_name, 'confidence', d.confidence,
                                                  'bbox', d.bbox, 'area_pct', d.area_pct))
                       FILTER (WHERE d.id IS NOT NULL), '[]') AS defects
       FROM inspections i
       LEFT JOIN defects d ON d.inspection_id = i.id
       WHERE ${clause}
       GROUP BY i.id
       ORDER BY i.id DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    res.json({ total: total.rows[0].n, limit, offset, items: rows });
  },
);

export default router;
