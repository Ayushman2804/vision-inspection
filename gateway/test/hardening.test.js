import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { pool, sslOptions } from '../src/db.js';
import { runInference } from '../src/services/inference.js';

// No database needed: these paths return before any query.
let server;
let base;
let fakeInference;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  // Stand-in inference service: the status code comes from the path's ?status= query.
  fakeInference = http.createServer((req, res) => {
    const status = Number(new URL(req.url, 'http://x').searchParams.get('status') || 200);
    req.resume();
    req.on('end', () => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ detail: 'internal detail that must not reach clients' }));
    });
  });
  fakeInference.listen(0);
  await new Promise((resolve) => fakeInference.once('listening', resolve));
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => fakeInference.close(resolve));
  await pool.end();
});

test('DB_SSL=true verifies the certificate; no-verify and false behave as named', () => {
  assert.deepEqual(sslOptions('true'), { rejectUnauthorized: true });
  assert.deepEqual(sslOptions('no-verify'), { rejectUnauthorized: false });
  assert.equal(sslOptions('false'), undefined);
});

async function inferenceError(status) {
  const saved = config.inferenceUrl;
  // runInference appends /predict?conf=..., so route the fake status through a query on the base URL.
  config.inferenceUrl = `http://127.0.0.1:${fakeInference.address().port}/x?status=${status}&`;
  try {
    await runInference(Buffer.from('x'), 'image/jpeg', 0.25);
    return null;
  } catch (e) {
    return e;
  } finally {
    config.inferenceUrl = saved;
  }
}

test('an image the inference service cannot decode is a 400, not a 502', async () => {
  const err = await inferenceError(400);
  assert.equal(err.status, 400);
  assert.match(err.message, /valid JPEG, PNG or WebP/);
});

test('inference outages return a generic 502 without the service detail', async () => {
  const err = await inferenceError(500);
  assert.equal(err.status, 502);
  assert.equal(err.message, 'Inference service error');
});

test('ALLOW_REGISTRATION=false closes sign-up with 403', async () => {
  const saved = config.allowRegistration;
  config.allowRegistration = false;
  try {
    const res = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'new@example.test', password: 'long-enough-1' }),
    });
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: 'Registration is closed' });
  } finally {
    config.allowRegistration = saved;
  }
});
