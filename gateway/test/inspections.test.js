import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, test } from 'node:test';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { migrate, pool } from '../src/db.js';
import { shouldStoreImage } from '../src/routes/inspect.js';
import { csvCell, toCsv } from '../src/utils.js';

// --- No database needed -------------------------------------------------------------------

test('uploads always keep their image; video frames follow SAVE_VIDEO_FRAMES', () => {
  assert.equal(shouldStoreImage('upload', 0, 'none'), true);
  assert.equal(shouldStoreImage('video', 3, 'none'), false);
  assert.equal(shouldStoreImage('video', 0, 'defects'), false);
  assert.equal(shouldStoreImage('video', 2, 'defects'), true);
  assert.equal(shouldStoreImage('video', 0, 'all'), true);
});

test('CSV cells are quoted and spreadsheet formulas are neutralised', () => {
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(0.5), '0.5');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell(new Date('2026-11-10T00:00:00Z')), '2026-11-10T00:00:00.000Z');
  assert.equal(toCsv(['a', 'b'], [{ a: 1, b: 'x' }]), 'a,b\r\n1,x\r\n');
});

// --- Needs Postgres (skipped without one unless REQUIRE_DB=1, like stats.test.js) ----------

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
let otherId;
let token;
let otherToken;

before(async () => {
  if (skip) return;
  await migrate();
  const mk = async (tag) => {
    const email = `insp-test-${tag}-${Date.now()}@example.test`;
    const { rows } = await pool.query("INSERT INTO users (email, password_hash) VALUES ($1, 'x') RETURNING id", [email]);
    return [rows[0].id, jwt.sign({ sub: rows[0].id, email }, config.jwtSecret, { expiresIn: '5m' })];
  };
  [userId, token] = await mk('a');
  [otherId, otherToken] = await mk('b');
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (userId) await pool.query('DELETE FROM users WHERE id = ANY($1)', [[userId, otherId]]); // cascades
  if (server) await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

async function insertInspection({ status = 'fail', source = 'upload', imagePath = null, defects = [] } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO inspections (user_id, source, image_path, status, defect_count, latency_ms, model_version)
     VALUES ($1, $2, $3, $4, $5, 12.5, 'test') RETURNING id`,
    [userId, source, imagePath, status, defects.length],
  );
  for (const [cls, conf] of defects) {
    await pool.query(
      `INSERT INTO defects (inspection_id, class_name, confidence, bbox, area_pct) VALUES ($1, $2, $3, '[0,0,1,1]', 1)`,
      [rows[0].id, cls, conf],
    );
  }
  return rows[0].id;
}

const auth = (t = token) => ({ Authorization: `Bearer ${t}` });

test('GET /inspections/:id returns one inspection with defects, scoped to the owner', { skip }, async () => {
  const id = await insertInspection({ defects: [['scratches', 0.6], ['inclusion', 0.9]] });

  const res = await fetch(`${base}/api/inspections/${id}`, { headers: auth() });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.id, id);
  assert.equal(body.defect_count, 2);
  assert.deepEqual(body.defects.map((d) => d.class_name), ['inclusion', 'scratches']); // by confidence

  assert.equal((await fetch(`${base}/api/inspections/${id}`, { headers: auth(otherToken) })).status, 404);
  assert.equal((await fetch(`${base}/api/inspections/abc`, { headers: auth() })).status, 400);
});

test('DELETE /inspections/:id removes the row, its defects and its image file', { skip }, async () => {
  await fs.mkdir(config.uploadDir, { recursive: true });
  const name = `test-${Date.now()}.jpg`;
  const file = path.join(config.uploadDir, name);
  await fs.writeFile(file, 'x');
  const id = await insertInspection({ imagePath: `/uploads/${name}`, defects: [['crazing', 0.5]] });

  assert.equal((await fetch(`${base}/api/inspections/${id}`, { method: 'DELETE', headers: auth(otherToken) })).status, 404);

  const res = await fetch(`${base}/api/inspections/${id}`, { method: 'DELETE', headers: auth() });
  assert.equal(res.status, 204);
  const left = await pool.query('SELECT count(*)::int AS n FROM defects WHERE inspection_id = $1', [id]);
  assert.equal(left.rows[0].n, 0);
  await assert.rejects(fs.access(file));
  assert.equal((await fetch(`${base}/api/inspections/${id}`, { method: 'DELETE', headers: auth() })).status, 404);
});

test('GET /inspections/export.csv exports the filtered history as CSV', { skip }, async () => {
  const failId = await insertInspection({ defects: [['patches', 0.7], ['patches', 0.8], ['scratches', 0.4]] });
  const passId = await insertInspection({ status: 'pass', source: 'video' });

  const res = await fetch(`${base}/api/inspections/export.csv?status=fail`, { headers: auth() });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/csv/);
  assert.match(res.headers.get('content-disposition'), /attachment; filename="inspections-\d{4}-\d{2}-\d{2}\.csv"/);
  const [header, ...lines] = (await res.text()).trim().split('\r\n');
  assert.equal(header, 'id,created_at,source,status,defect_count,latency_ms,model_version,image_url,defect_classes,max_confidence');
  const row = lines.find((l) => l.startsWith(`${failId},`));
  assert.ok(row, 'fail row exported');
  assert.match(row, /,patches:2;scratches:1,0\.8/);
  assert.ok(!lines.some((l) => l.startsWith(`${passId},`)), 'status filter applied');

  const other = await (await fetch(`${base}/api/inspections/export.csv`, { headers: auth(otherToken) })).text();
  assert.equal(other.trim().split('\r\n').length, 1, 'other user only gets the header');

  assert.equal((await fetch(`${base}/api/inspections/export.csv?from=nope`, { headers: auth() })).status, 400);
});
