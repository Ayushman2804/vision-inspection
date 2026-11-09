/**
 * Seed demo history with REAL model output: NEU-DET validation images are posted through
 * POST /api/inspect against the running stack, so every detection comes from the deployed model.
 * Afterwards the rows are backdated across the last N days (uneven volume per day) so the
 * Dashboard timeline has real shape.
 *
 * Runs inside the gateway container (it needs the API and the database):
 *
 *   docker compose cp ml/data/neu-det/images/val gateway:/tmp/neu-val
 *   docker compose exec gateway npm run seed -- --reset
 *
 * Options: --images DIR (default /tmp/neu-val), --count N (default 120), --days N (default 7),
 *          --reset (delete this user's seeded rows, alerts and stored images first),
 *          --api URL (default http://localhost:$PORT).
 * Demo user: SEED_EMAIL / SEED_PASSWORD (see gateway/.env.example). Created if missing.
 * Seeded inspections are tagged model_version = 'seed-demo:<real model version>' and seeded alerts
 * carry details.seed = true, so they're removable:
 *   DELETE FROM inspections WHERE model_version LIKE 'seed-demo%';
 * Refuses to run with NODE_ENV=production.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../src/config.js';
import { pool } from '../src/db.js';

const SEED_PREFIX = 'seed-demo';
const EMAIL = (process.env.SEED_EMAIL || 'demo@example.test').toLowerCase();
const PASSWORD = process.env.SEED_PASSWORD || 'demo-password-123';
const UPLOAD_SHARE = 0.2; // ~1 upload : 4 video frames, like real use

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

// Small deterministic PRNG so repeated seeds pick the same images and timeline shape.
function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function api(base, method, route, { token, json, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let body;
  if (json) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (form) body = form;
  const res = await fetch(`${base}${route}`, { method, headers, body });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function getToken(base) {
  let r = await api(base, 'POST', '/api/auth/login', { json: { email: EMAIL, password: PASSWORD } });
  if (r.status === 200) return r.data.token;
  r = await api(base, 'POST', '/api/auth/register', { json: { email: EMAIL, password: PASSWORD } });
  if (r.status === 201) return r.data.token;
  throw new Error(`Could not sign in or register ${EMAIL}: ${r.status} ${r.data?.error || ''}`);
}

/** Pick `count` images, round-robin across the defect classes (filename prefix), shuffled within each class. */
async function pickImages(dir, count, rand) {
  const files = (await fs.readdir(dir)).filter((f) => /\.(jpe?g|png|bmp)$/i.test(f)).sort();
  if (!files.length) throw new Error(`No images in ${dir}`);
  const byClass = new Map();
  for (const f of files) {
    const cls = f.replace(/_\d+\.\w+$/, '');
    if (!byClass.has(cls)) byClass.set(cls, []);
    byClass.get(cls).push(f);
  }
  for (const list of byClass.values()) list.sort(() => rand() - 0.5);
  const classes = [...byClass.keys()];
  const picked = [];
  for (let i = 0; picked.length < count; i++) {
    const list = byClass.get(classes[i % classes.length]);
    picked.push(list[Math.floor(i / classes.length) % list.length]);
  }
  return picked.sort(() => rand() - 0.5);
}

/** Timestamps over the last `days` days: uneven daily volume, within a 14 h window from 06:00 server
 *  time (UTC in the container), today capped at now. */
function backdatedTimes(n, days, rand) {
  const now = new Date();
  const weights = Array.from({ length: days }, () => 0.4 + rand() * 1.6);
  weights[days - 1] *= 0.6; // today is only partly over
  const total = weights.reduce((a, b) => a + b, 0);
  const perDay = weights.map((w) => Math.round((w / total) * n));
  perDay[Math.max(0, days - 2)] += n - perDay.reduce((a, b) => a + b, 0); // rounding remainder goes to yesterday
  const times = [];
  perDay.forEach((count, d) => {
    const day = new Date(now);
    day.setDate(now.getDate() - (days - 1 - d));
    for (let k = 0; k < count; k++) {
      const t = new Date(day);
      t.setHours(6, 0, 0, 0);
      t.setTime(t.getTime() + rand() * 14 * 3_600_000);
      times.push(t > now ? new Date(now.getTime() - rand() * 3_600_000) : t);
    }
  });
  return times.sort((a, b) => a - b);
}

async function reset(userId) {
  const { rows } = await pool.query(
    `DELETE FROM inspections WHERE user_id = $1 AND model_version LIKE $2 RETURNING image_path`,
    [userId, `${SEED_PREFIX}%`],
  );
  let files = 0;
  for (const { image_path: p } of rows) {
    if (!p) continue;
    await fs.rm(path.join(config.uploadDir, path.basename(p)), { force: true });
    files += 1;
  }
  const alerts = await pool.query(`DELETE FROM alerts WHERE user_id = $1 AND details->>'seed' = 'true'`, [userId]);
  console.log(`Reset: removed ${rows.length} seeded inspections, ${files} stored images, ${alerts.rowCount} alerts.`);
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed with NODE_ENV=production');
  const dir = arg('images', '/tmp/neu-val');
  const count = Number(arg('count', 120));
  const days = Number(arg('days', 7));
  const base = (arg('api', `http://localhost:${config.port}`) || '').replace(/\/$/, '');
  const rand = mulberry32(42);

  const token = await getToken(base);
  const { rows: users } = await pool.query('SELECT id FROM users WHERE email = $1', [EMAIL]);
  const userId = users[0].id;
  if (process.argv.includes('--reset')) await reset(userId);

  const images = await pickImages(dir, count, rand);
  const done = []; // { id, alertId }
  let defects = 0;
  let version = null;
  for (const [i, file] of images.entries()) {
    const buf = await fs.readFile(path.join(dir, file));
    const type = file.endsWith('.png') ? 'image/png' : file.endsWith('.bmp') ? 'image/bmp' : 'image/jpeg';
    const form = new FormData();
    form.append('conf', '0.25');
    form.append('source', rand() < UPLOAD_SHARE ? 'upload' : 'video');
    form.append('image', new Blob([buf], { type }), file);
    const r = await api(base, 'POST', '/api/inspect', { token, form });
    if (r.status !== 201) throw new Error(`Inspect failed for ${file}: ${r.status} ${r.data?.error || ''}`);
    done.push({ id: r.data.inspection.id, alertId: r.data.alert?.id ?? null });
    defects += r.data.detections.length;
    version = r.data.inspection.model_version;
    if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${images.length} inspected`);
  }

  // Backdate in id order so "newest first" by id and by time agree; alerts follow their inspection.
  const times = backdatedTimes(done.length, days, rand);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [k, { id, alertId }] of done.entries()) {
      await client.query(`UPDATE inspections SET created_at = $2, model_version = $3 WHERE id = $1`, [
        id,
        times[k],
        `${SEED_PREFIX}:${version}`,
      ]);
      if (alertId) {
        await client.query(
          `UPDATE alerts SET triggered_at = $2, details = details || '{"seed": true}'::jsonb WHERE id = $1`,
          [alertId, times[k]],
        );
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const { rows: summary } = await pool.query(
    `SELECT count(*)::int AS n,
            count(*) FILTER (WHERE status = 'fail')::int AS fails,
            count(*) FILTER (WHERE source = 'upload')::int AS uploads
     FROM inspections WHERE user_id = $1 AND model_version LIKE $2`,
    [userId, `${SEED_PREFIX}%`],
  );
  const s = summary[0];
  const alerts = done.filter((d) => d.alertId).length;
  console.log(
    `Seeded ${done.length} real inspections (${s.fails} fail, ${s.n - s.fails} pass; ${s.uploads} uploads) with ${defects} detections ` +
      `from ${version}, ${alerts} alert(s), spread over ${days} days for ${EMAIL}.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
