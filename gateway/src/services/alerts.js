import { pool } from '../db.js';
import { config } from '../config.js';

/**
 * Pure rule: alert when the window is full and the share of failed inspections
 * in it reaches the threshold.
 */
export function shouldAlert(statuses, window, threshold) {
  if (statuses.length < window) return null;
  const recent = statuses.slice(0, window);
  const failRate = recent.filter((s) => s === 'fail').length / recent.length;
  return failRate >= threshold ? failRate : null;
}

/** Evaluate the defect-rate rule for a user; persists and returns the alert if one fires. */
export async function evaluateAlert(userId) {
  const { rows } = await pool.query('SELECT status FROM inspections WHERE user_id = $1 ORDER BY id DESC LIMIT $2', [
    userId,
    config.alertWindow,
  ]);
  const failRate = shouldAlert(
    rows.map((r) => r.status),
    config.alertWindow,
    config.alertThreshold,
  );
  if (failRate === null) return null;

  const cooldown = await pool.query(
    `SELECT 1 FROM alerts WHERE user_id = $1 AND triggered_at > now() - make_interval(secs => $2::double precision) LIMIT 1`,
    [userId, config.alertCooldownSec],
  );
  if (cooldown.rowCount > 0) return null;

  const details = { fail_rate: Number(failRate.toFixed(3)), window: config.alertWindow, threshold: config.alertThreshold };
  const { rows: inserted } = await pool.query(
    `INSERT INTO alerts (user_id, rule, details) VALUES ($1, 'high_defect_rate', $2) RETURNING id, rule, details, triggered_at`,
    [userId, details],
  );
  return inserted[0];
}
