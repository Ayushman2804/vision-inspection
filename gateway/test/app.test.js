import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { pool } from '../src/db.js';

// These requests fail validation before any DB query, so no database is needed.
let server;
let base;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

test('error thrown in an async handler reaches the JSON error middleware (Express 5)', async () => {
  const res = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'not-an-email', password: 'x' }),
  });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'Valid email required' });
});

test('protected route without a token returns 401', async () => {
  const res = await fetch(`${base}/api/inspections`);
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: 'Missing token' });
});

test('unknown route returns JSON 404', async () => {
  const res = await fetch(`${base}/api/nope`);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'Not found' });
});
