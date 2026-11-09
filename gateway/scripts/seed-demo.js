/**
 * Fill the database with mock inspection history for demos and UI work.
 *
 *   npm run seed                      # 7 days, ~40 inspections/day, for the demo user
 *   npm run seed -- --days 30 --per-day 80
 *   npm run seed -- --reset           # delete this user's seeded rows first
 *
 * Creates (or reuses) the user SEED_EMAIL / SEED_PASSWORD (defaults below, also in .env.example).
 * Seeded rows use model_version "seed-demo", so they are easy to spot and delete:
 *   DELETE FROM inspections WHERE model_version = 'seed-demo';
 * Never run against a production database.
 */
import bcrypt from 'bcryptjs';
import { config } from '../src/config.js';
import { migrate, pool } from '../src/db.js';

const SEED_VERSION = 'seed-demo';
const EMAIL = (process.env.SEED_EMAIL || 'demo@example.test').toLowerCase();
const PASSWORD = process.env.SEED_PASSWORD || 'demo-password-123';

// Rough NEU-DET-like mix: weights for how often each class appears, and typical confidence.
const CLASSES = [
  { name: 'scratches', weight: 0.24, conf: 0.72 },
  { name: 'inclusion', weight: 0.2, conf: 0.68 },
  { name: 'patches', weight: 0.2, conf: 0.8 },
  { name: 'pitted_surface', weight: 0.14, conf: 0.66 },
  { name: 'crazing', weight: 0.12, conf: 0.42 },
  { name: 'rolled-in_scale', weight: 0.1, conf: 0.45 },
];

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? Number(process.argv[i + 1]) : fallback;
}

// Small deterministic PRNG so repeated seeds give the same-looking data.
function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickClass(rand) {
  let r = rand();
  for (const c of CLASSES) {
    if ((r -= c.weight) <= 0) return c;
  }
  return CLASSES[0];
}

function mockDefect(rand) {
  const c = pickClass(rand);
  const w = 200;
  const h = 200; // NEU-DET images are 200x200
  const bw = 20 + rand() * 120;
  const bh = 20 + rand() * 120;
  const x1 = rand() * (w - bw);
  const y1 = rand() * (h - bh);
  const confidence = Math.min(0.97, Math.max(0.25, c.conf + (rand() - 0.5) * 0.3));
  return {
    class_name: c.name,
    confidence: Number(confidence.toFixed(4)),
    bbox: [x1, y1, x1 + bw, y1 + bh].map((v) => Number(v.toFixed(1))),
    area_pct: Number(((bw * bh) / (w * h) * 100).toFixed(2)),
  };
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed with NODE_ENV=production');
  const days = arg('days', 7);
  const perDay = arg('per-day', 40);
  const reset = process.argv.includes('--reset');
  const rand = mulberry32(42);

  await migrate();
  const hash = await bcrypt.hash(PASSWORD, 10);
  const { rows: users } = await pool.query(
    `INSERT INTO users (email, password_hash) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
     RETURNING id`,
    [EMAIL, hash],
  );
  const userId = users[0].id;

  if (reset) {
    await pool.query(`DELETE FROM inspections WHERE user_id = $1 AND model_version = $2`, [userId, SEED_VERSION]);
    await pool.query(`DELETE FROM alerts WHERE user_id = $1 AND details->>'seed' = 'true'`, [userId]);
  }

  const client = await pool.connect();
  let inspections = 0;
  let defects = 0;
  let alerts = 0;
  try {
    await client.query('BEGIN');
    const now = Date.now();
    for (let d = days - 1; d >= 0; d--) {
      // One "bad shift" per run: day 2 has a much higher defect rate, which also triggers alerts.
      const failRate = d === 2 ? 0.6 : 0.18 + rand() * 0.12;
      const count = Math.round(perDay * (0.7 + rand() * 0.6));
      const recent = [];
      let sinceAlert = config.alertWindow;
      for (let k = 0; k < count; k++) {
        const ts = new Date(now - d * 86_400_000 - (1 - k / count) * 10 * 3_600_000); // spread over a 10 h shift
        const fail = rand() < failRate;
        const dets = fail ? Array.from({ length: 1 + Math.floor(rand() * 3) }, () => mockDefect(rand)) : [];
        const source = rand() < 0.8 ? 'video' : 'upload';
        const latency = Number((28 + rand() * 40).toFixed(2));
        const { rows } = await client.query(
          `INSERT INTO inspections (user_id, source, image_path, status, defect_count, latency_ms, model_version, created_at)
           VALUES ($1, $2, NULL, $3, $4, $5, $6, $7) RETURNING id`,
          [userId, source, fail ? 'fail' : 'pass', dets.length, latency, SEED_VERSION, ts],
        );
        for (const det of dets) {
          await client.query(
            `INSERT INTO defects (inspection_id, class_name, confidence, bbox, area_pct) VALUES ($1, $2, $3, $4, $5)`,
            [rows[0].id, det.class_name, det.confidence, JSON.stringify(det.bbox), det.area_pct],
          );
        }
        inspections += 1;
        defects += dets.length;

        // Same rule as services/alerts.js: fail share of the last ALERT_WINDOW inspections, with a cooldown
        // of ALERT_WINDOW inspections between seeded alerts.
        recent.push(fail);
        if (recent.length > config.alertWindow) recent.shift();
        const rate = recent.filter(Boolean).length / recent.length;
        sinceAlert += 1;
        if (recent.length === config.alertWindow && rate >= config.alertThreshold && sinceAlert >= config.alertWindow) {
          sinceAlert = 0;
          const details = { fail_rate: Number(rate.toFixed(3)), window: config.alertWindow, threshold: config.alertThreshold, seed: true };
          await client.query(`INSERT INTO alerts (user_id, rule, details, triggered_at) VALUES ($1, 'high_defect_rate', $2, $3)`, [
            userId,
            details,
            ts,
          ]);
          alerts += 1;
        }
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  console.log(`Seeded ${inspections} inspections, ${defects} defects, ${alerts} alerts over ${days} days for ${EMAIL}.`);
  console.log(`Sign in with SEED_EMAIL / SEED_PASSWORD (see .env.example). Remove with --reset or model_version='${SEED_VERSION}'.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
