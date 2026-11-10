import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { migrate, pool } from '../src/db.js';

// Needs Postgres (DATABASE_URL, default localhost:5432). Skipped when no database is reachable,
// unless REQUIRE_DB=1 (CI sets it, so a broken DB setup fails instead of silently skipping).
let dbError = null;
try {
  await pool.query('SELECT 1');
} catch (e) {
  dbError = e;
}
if (dbError && process.env.REQUIRE_DB === '1') throw dbError;
const skip = dbError ? `no database (${dbError.code || dbError.message})` : false;

let server;
let base;
let userId;
let token;

before(async () => {
  if (skip) return;
  await migrate();
  const email = `stats-test-${Date.now()}@example.test`;
  const { rows } = await pool.query(
    "INSERT INTO users (email, password_hash) VALUES ($1, 'x') RETURNING id",
    [email],
  );
  userId = rows[0].id;
  token = jwt.sign({ sub: userId, email }, config.jwtSecret, { expiresIn: '5m' });
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (userId) await pool.query('DELETE FROM users WHERE id = $1', [userId]); // cascades
  if (server) await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

async function insertAt(offset, status) {
  await pool.query(
    `INSERT INTO inspections (user_id, status, defect_count, latency_ms, created_at)
     VALUES ($1, $2, $3, 10, now() - $4::interval)`,
    [userId, status, status === 'fail' ? 1 : 0, offset],
  );
}

// Bucket start for a moment in the past, computed by Postgres so the session time zone matches.
async function bucketOf(unit, offset) {
  const { rows } = await pool.query(`SELECT date_trunc('${unit}', now() - $1::interval) AS b`, [offset]);
  return rows[0].b.toISOString();
}

async function getStats(days) {
  const res = await fetch(`${base}/api/stats?days=${days}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  return res.json();
}

// Steps are calendar units in the session time zone, so a day can be 23 or 25 h across DST.
function assertContiguous(timeline, stepMs, slackMs = 0) {
  for (let k = 1; k < timeline.length; k++) {
    const gap = new Date(timeline[k].bucket) - new Date(timeline[k - 1].bucket);
    assert.ok(Math.abs(gap - stepMs) <= slackMs, `bucket ${k} is ${gap} ms after bucket ${k - 1}`);
  }
}

test('daily timeline zero-fills days with no inspections', { skip }, async () => {
  await insertAt('5 days', 'fail');
  await insertAt('5 days', 'pass');
  await insertAt('1 day', 'fail');

  const s = await getStats(7);
  assert.equal(s.unit, 'day');
  // 7 days back to today, inclusive at both ends.
  assert.equal(s.timeline.length, 8);
  assertContiguous(s.timeline, 24 * 3600 * 1000, 3600 * 1000);

  const byBucket = Object.fromEntries(s.timeline.map((p) => [new Date(p.bucket).toISOString(), p]));
  const d5 = byBucket[await bucketOf('day', '5 days')];
  const d1 = byBucket[await bucketOf('day', '1 day')];
  assert.deepEqual([d5.total, d5.fails], [2, 1]);
  assert.deepEqual([d1.total, d1.fails], [1, 1]);
  // The gap between them is present as zeros, not missing.
  for (const off of ['4 days', '3 days', '2 days']) {
    const p = byBucket[await bucketOf('day', off)];
    assert.ok(p, `missing bucket for ${off} ago`);
    assert.deepEqual([p.total, p.fails], [0, 0]);
  }
  assert.equal(s.timeline.reduce((n, p) => n + p.total, 0), s.totals.total);
});

test('hourly timeline zero-fills empty hours', { skip }, async () => {
  await insertAt('6 hours', 'fail');
  await insertAt('2 hours', 'pass');

  const s = await getStats(1);
  assert.equal(s.unit, 'hour');
  assert.equal(s.timeline.length, 25); // 24 h back to the current hour, inclusive
  assertContiguous(s.timeline, 3600 * 1000);

  const byBucket = Object.fromEntries(s.timeline.map((p) => [new Date(p.bucket).toISOString(), p]));
  assert.equal(byBucket[await bucketOf('hour', '6 hours')].total, 1);
  assert.equal(byBucket[await bucketOf('hour', '2 hours')].total, 1);
  for (const off of ['5 hours', '4 hours', '3 hours']) {
    assert.equal(byBucket[await bucketOf('hour', off)].total, 0, `${off} ago should be 0`);
  }
  assert.equal(s.timeline.reduce((n, p) => n + p.total, 0), s.totals.total);
});
