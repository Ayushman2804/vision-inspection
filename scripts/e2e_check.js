#!/usr/bin/env node
/**
 * End-to-end API check against a running stack (gateway + inference + Postgres).
 *
 *   docker compose up --build -d
 *   node scripts/e2e_check.js                      # default http://localhost:4000
 *   API_URL=http://localhost:4000 ALERT_WINDOW=20 node scripts/e2e_check.js
 *
 * Exercises real HTTP routes through the Express 5 router, multer, Postgres and the model.
 * Every run uses fresh users (timestamped emails), so it doesn't depend on existing data.
 * ALERT_WINDOW must match the gateway's ALERT_WINDOW (default 20). Starting the gateway with a
 * smaller window (e.g. ALERT_WINDOW=3) makes the alert check faster.
 * Exit code 0 if every assertion passes, 1 otherwise. Needs Node 20+ (global fetch/FormData).
 *
 * Fixture: scripts/fixtures/neu-scratches_270.jpg (NEU-DET validation image). With the shipped
 * model it has detections at conf 0.25 (inspection fails) and none at conf 0.95 (passes).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = (process.env.API_URL || 'http://localhost:4000').replace(/\/$/, '');
const WINDOW = Number(process.env.ALERT_WINDOW || 20);
const here = path.dirname(fileURLToPath(import.meta.url));
const IMAGE = fs.readFileSync(path.join(here, 'fixtures', 'neu-scratches_270.jpg'));
const RUN = Date.now();
const PASSWORD = 'e2e-password-123';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

async function call(method, route, { token, json, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let body;
  if (json) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (form) {
    body = form;
  }
  const res = await fetch(`${API}${route}`, { method, headers, body });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data, headers: res.headers };
}

function inspectForm({ conf = 0.25, source = 'upload', file = IMAGE, type = 'image/jpeg', name = 'steel.jpg', withFile = true } = {}) {
  const form = new FormData();
  form.append('conf', String(conf));
  form.append('source', source);
  if (withFile) form.append('image', new Blob([file], { type }), name);
  return form;
}

const inspect = (token, opts) => call('POST', '/api/inspect', { token, form: inspectForm(opts) });

async function registerUser(tag) {
  const email = `e2e-${tag}-${RUN}@example.test`;
  const r = await call('POST', '/api/auth/register', { json: { email, password: PASSWORD } });
  return { email, token: r.data?.token, res: r };
}

async function main() {
  console.log(`E2E check against ${API} (alert window ${WINDOW})\n`);
  const health = await call('GET', '/api/health');
  if (health.status !== 200) {
    console.error(`Gateway not healthy at ${API}/api/health (status ${health.status}). Is the stack running?`);
    process.exit(1);
  }

  // --- Auth -----------------------------------------------------------------------------------
  const emailA = `e2e-a-${RUN}@example.test`;
  let r = await call('POST', '/api/auth/register', { json: { email: emailA, password: 'short' } });
  check('register rejects a short password (400)', r.status === 400, `status ${r.status}: ${r.data?.error}`);

  r = await call('POST', '/api/auth/register', { json: { email: emailA, password: PASSWORD } });
  check('register succeeds (201 + token)', r.status === 201 && typeof r.data?.token === 'string', `status ${r.status}`);

  r = await call('POST', '/api/auth/register', { json: { email: emailA, password: PASSWORD } });
  check('duplicate email returns 409', r.status === 409, `status ${r.status}: ${r.data?.error}`);

  r = await call('POST', '/api/auth/login', { json: { email: emailA, password: 'wrong-password-1' } });
  check('login with wrong password returns 401', r.status === 401, `status ${r.status}`);

  r = await call('POST', '/api/auth/login', { json: { email: emailA, password: PASSWORD } });
  const tokenA = r.data?.token;
  check('login succeeds (200 + token)', r.status === 200 && typeof tokenA === 'string', `status ${r.status}`);

  // --- Inspect --------------------------------------------------------------------------------
  r = await inspect(null);
  check('/api/inspect without a token returns 401', r.status === 401, `status ${r.status}`);

  r = await inspect(tokenA, { source: 'upload', conf: 0.25 });
  const upload = r.data;
  const imageUrl = upload?.inspection?.image_url;
  check(
    'upload inspection returns 201 with detections and an image URL',
    r.status === 201 && upload.inspection.status === 'fail' && upload.detections.length > 0 && /^\/uploads\/.+\.jpg$/.test(imageUrl || ''),
    `status ${r.status}, ${upload?.detections?.length} detections, ${imageUrl}`,
  );

  if (imageUrl) {
    const img = await fetch(`${API}${imageUrl}`);
    const bytes = Buffer.from(await img.arrayBuffer());
    check(
      'stored image URL serves the uploaded file',
      img.status === 200 && (img.headers.get('content-type') || '').startsWith('image/jpeg') && bytes.equals(IMAGE),
      `status ${img.status}, ${img.headers.get('content-type')}, ${bytes.length} bytes`,
    );
  } else {
    check('stored image URL serves the uploaded file', false, 'no image_url to fetch');
  }

  r = await inspect(tokenA, { file: Buffer.from('not an image'), type: 'text/plain', name: 'notes.txt' });
  check('non-image upload returns 415', r.status === 415, `status ${r.status}: ${r.data?.error}`);

  r = await inspect(tokenA, { withFile: false });
  check('missing file returns 400', r.status === 400, `status ${r.status}: ${r.data?.error}`);

  r = await inspect(tokenA, { source: 'video', conf: 0.25 });
  // Default SAVE_VIDEO_FRAMES=defects: a video frame keeps its image only when the model found a defect.
  check(
    'video frame keeps its image only if it has defects (SAVE_VIDEO_FRAMES=defects)',
    r.status === 201 &&
      r.data.inspection.source === 'video' &&
      (r.data.inspection.defect_count > 0) === (r.data.inspection.image_url !== null),
    `status ${r.status}, defects ${r.data?.inspection?.defect_count}, image_url ${r.data?.inspection?.image_url}`,
  );

  r = await inspect(tokenA, { source: 'upload', conf: 0.95 });
  check('high-confidence inspection passes with no detections', r.status === 201 && r.data.inspection.status === 'pass', `status ${r.data?.inspection?.status}`);

  // User A now has: upload/fail, video/fail, upload/pass (rejected requests store nothing).
  const detectedClass = upload?.detections?.[0]?.class_name;

  // --- History --------------------------------------------------------------------------------
  r = await call('GET', '/api/inspections', { token: tokenA });
  check('/api/inspections total counts only stored inspections (3)', r.status === 200 && r.data.total === 3 && r.data.items.length === 3, `total ${r.data?.total}`);

  r = await call('GET', '/api/inspections?status=fail', { token: tokenA });
  check('status filter (fail) returns 2, all fail', r.data.total === 2 && r.data.items.every((i) => i.status === 'fail'), `total ${r.data?.total}`);

  r = await call('GET', '/api/inspections?status=pass', { token: tokenA });
  check('status filter (pass) returns 1, all pass', r.data.total === 1 && r.data.items.every((i) => i.status === 'pass'), `total ${r.data?.total}`);

  r = await call('GET', '/api/inspections?source=video', { token: tokenA });
  check('source filter (video) returns 1, all video', r.data.total === 1 && r.data.items.every((i) => i.source === 'video'), `total ${r.data?.total}`);

  r = await call('GET', `/api/inspections?class=${encodeURIComponent(detectedClass)}`, { token: tokenA });
  check(
    `class filter (${detectedClass}) returns 2, each containing that class`,
    r.data.total === 2 && r.data.items.every((i) => i.defects.some((d) => d.class_name === detectedClass)),
    `total ${r.data?.total}`,
  );

  const otherClass = ['crazing', 'patches', 'inclusion'].find((c) => !upload.detections.some((d) => d.class_name === c));
  r = await call('GET', `/api/inspections?class=${otherClass}`, { token: tokenA });
  check(`class filter (${otherClass}, not detected) returns 0`, r.data.total === 0, `total ${r.data?.total}`);

  r = await call('GET', '/api/inspections?limit=1&offset=1', { token: tokenA });
  check('paging (limit=1, offset=1) returns 1 item and full total', r.data.items.length === 1 && r.data.total === 3, `items ${r.data?.items?.length}, total ${r.data?.total}`);

  // --- Stats ----------------------------------------------------------------------------------
  r = await call('GET', '/api/stats?days=7', { token: tokenA });
  const s7 = r.data;
  const detectionCount = upload.detections.length * 2; // upload + video both used the same image at conf 0.25
  const byClassSum = (s7.by_class || []).reduce((n, c) => n + c.count, 0);
  check(
    '/api/stats returns totals, by_class and timeline',
    r.status === 200 && s7.totals?.total === 3 && s7.totals.fails === 2 && s7.totals.passes === 1 && Array.isArray(s7.by_class) && Array.isArray(s7.timeline),
    `totals ${JSON.stringify(s7.totals)}`,
  );
  check('stats by_class counts every stored defect', byClassSum === detectionCount, `${byClassSum} vs ${detectionCount}`);
  check('stats days=7 uses daily buckets', s7.unit === 'day' && s7.timeline.length >= 1, `unit ${s7.unit}`);

  r = await call('GET', '/api/stats?days=1', { token: tokenA });
  check('stats days=1 uses hourly buckets', r.data.unit === 'hour' && r.data.timeline.every((b) => new Date(b.bucket).getUTCMinutes() === 0), `unit ${r.data?.unit}`);

  // --- Alert rule -----------------------------------------------------------------------------
  const c = await registerUser('alert');
  let firedAt = null;
  for (let k = 1; k <= WINDOW; k++) {
    r = await inspect(c.token, { source: 'video', conf: 0.25 });
    if (r.data?.alert && firedAt === null) firedAt = k;
  }
  check(
    `alert fires exactly when the window (${WINDOW}) fills with failures`,
    firedAt === WINDOW,
    firedAt === null ? 'never fired' : `fired on inspection ${firedAt}`,
  );
  r = await inspect(c.token, { source: 'video', conf: 0.25 });
  const alerts = await call('GET', '/api/alerts', { token: c.token });
  check(
    'cooldown prevents a duplicate alert on the next failure',
    r.data.alert === null && alerts.data.items.length === 1 && alerts.data.items[0].rule === 'high_defect_rate',
    `next alert ${JSON.stringify(r.data?.alert)}, stored alerts ${alerts.data?.items?.length}`,
  );

  // --- Isolation ------------------------------------------------------------------------------
  const b = await registerUser('b');
  const [hb, sb, ab] = await Promise.all([
    call('GET', '/api/inspections', { token: b.token }),
    call('GET', '/api/stats?days=90', { token: b.token }),
    call('GET', '/api/alerts', { token: b.token }),
  ]);
  check(
    "a second user sees none of the first users' data",
    hb.data.total === 0 && hb.data.items.length === 0 && sb.data.totals.total === 0 && sb.data.by_class.length === 0 && ab.data.items.length === 0,
    `inspections ${hb.data?.total}, stats ${sb.data?.totals?.total}, alerts ${ab.data?.items?.length}`,
  );
  r = await call('GET', '/api/inspections?class=scratches', { token: b.token });
  check("second user's filtered history is also empty", r.data.total === 0, `total ${r.data?.total}`);

  // --- Summary --------------------------------------------------------------------------------
  const failed = results.filter((x) => !x.ok);
  console.log(`\n${results.length - failed.length}/${results.length} assertions passed`);
  if (failed.length) {
    console.log(`Failed: ${failed.map((f) => f.name).join('; ')}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
