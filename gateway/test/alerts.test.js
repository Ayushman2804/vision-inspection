import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shouldAlert } from '../src/services/alerts.js';

test('no alert until the window is full', () => {
  assert.equal(shouldAlert(['fail', 'fail'], 5, 0.5), null);
});

test('alerts when the failure share reaches the threshold', () => {
  const statuses = ['fail', 'fail', 'pass', 'fail', 'pass']; // 3/5 = 0.6
  assert.equal(shouldAlert(statuses, 5, 0.5), 0.6);
});

test('does not alert below the threshold', () => {
  assert.equal(shouldAlert(['pass', 'pass', 'pass', 'fail', 'pass'], 5, 0.5), null);
});

test('only the most recent window counts', () => {
  const statuses = ['pass', 'pass', 'pass', 'pass', 'pass', 'fail', 'fail', 'fail', 'fail', 'fail'];
  assert.equal(shouldAlert(statuses, 5, 0.5), null);
});
