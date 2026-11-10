import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { clamp } from '../utils.js';

const router = Router();

router.get(
  '/stats',
  requireAuth,
  async (req, res) => {
    const days = clamp(req.query.days, 1, 90, 7);
    const uid = req.user.id;
    const unit = days <= 2 ? 'hour' : 'day'; // whitelisted value, safe to interpolate

    const [totals, byClass, timeline] = await Promise.all([
      pool.query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE status = 'fail')::int AS fails,
                count(*) FILTER (WHERE status = 'pass')::int AS passes,
                COALESCE(round(avg(latency_ms)::numeric, 1), 0)::float AS avg_latency_ms
         FROM inspections
         WHERE user_id = $1 AND created_at > now() - make_interval(days => $2::int)`,
        [uid, days],
      ),
      pool.query(
        `SELECT d.class_name, count(*)::int AS count, round(avg(d.confidence)::numeric, 3)::float AS avg_confidence
         FROM defects d JOIN inspections i ON i.id = d.inspection_id
         WHERE i.user_id = $1 AND i.created_at > now() - make_interval(days => $2::int)
         GROUP BY d.class_name ORDER BY count DESC`,
        [uid, days],
      ),
      // One row per bucket across the whole range, so empty hours/days come back as 0
      // instead of being missing (which made the line chart bridge the gap).
      pool.query(
        `WITH buckets AS (
           SELECT generate_series(
                    date_trunc('${unit}', now() - make_interval(days => $2::int)),
                    date_trunc('${unit}', now()),
                    interval '1 ${unit}'
                  ) AS bucket
         )
         SELECT b.bucket,
                count(i.id)::int AS total,
                count(i.id) FILTER (WHERE i.status = 'fail')::int AS fails
         FROM buckets b
         LEFT JOIN inspections i
           ON i.user_id = $1
          AND i.created_at > now() - make_interval(days => $2::int)
          AND date_trunc('${unit}', i.created_at) = b.bucket
         GROUP BY b.bucket ORDER BY b.bucket`,
        [uid, days],
      ),
    ]);

    const t = totals.rows[0];
    res.json({
      days,
      unit,
      totals: { ...t, defect_rate: t.total ? Number((t.fails / t.total).toFixed(3)) : 0 },
      by_class: byClass.rows,
      timeline: timeline.rows,
    });
  },
);

router.get(
  '/alerts',
  requireAuth,
  async (req, res) => {
    const { rows } = await pool.query(
      'SELECT id, rule, details, triggered_at FROM alerts WHERE user_id = $1 ORDER BY id DESC LIMIT 50',
      [req.user.id],
    );
    res.json({ items: rows });
  },
);

export default router;
