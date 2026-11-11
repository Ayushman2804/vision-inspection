import { useSyncExternalStore } from 'react';

/*
 * Cold-start awareness for hosts that put idle services to sleep (Render free: ~15 min idle,
 * up to a minute to wake). The chain is frontend -> gateway -> inference, so the first request
 * after idle can wait for two containers.
 *
 * - warmUp() runs once on app load: a non-blocking GET /api/health, which wakes the gateway, and the
 *   gateway in turn wakes inference. It re-checks every 5 s while inference is still waking (2 min max).
 *   This is a one-off on page load, not a keep-alive.
 * - Any API request slower than SLOW_MS also flags the server as waking.
 * - useServerWaking() drives the "Waking the server" notice; api.js uses isWaking() to word errors.
 *
 * Locally everything answers in milliseconds, so the notice never appears.
 */
export const SLOW_MS = 3000;
export const WAKING_MESSAGE = 'Waking the server, this can take up to a minute.';
const WARMUP_LIMIT_MS = 120_000;
const WARMUP_RETRY_MS = 5000;

let waking = false;
let slowInFlight = 0;
let warmupPending = false; // health hasn't reported inference ready yet, and was slow or failed
const listeners = new Set();

function update() {
  const next = warmupPending || slowInFlight > 0;
  if (next !== waking) {
    waking = next;
    listeners.forEach((l) => l());
  }
}

export const isWaking = () => waking;

export function useServerWaking() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => waking,
  );
}

/** Wrap an API call: if it is still pending after SLOW_MS, the server is probably waking up. */
export function trackSlow(promise) {
  let counted = false;
  const timer = setTimeout(() => {
    counted = true;
    slowInFlight += 1;
    update();
  }, SLOW_MS);
  return promise.finally(() => {
    clearTimeout(timer);
    if (counted) {
      slowInFlight -= 1;
      update();
    }
  });
}

let started = false;

/** Fire-and-forget warm-up of gateway and inference. Safe to call more than once. */
export function warmUp(baseUrl) {
  if (started) return;
  started = true;
  const deadline = Date.now() + WARMUP_LIMIT_MS;

  const check = async () => {
    const slowTimer = setTimeout(() => {
      warmupPending = true;
      update();
    }, SLOW_MS);
    // Settled: inference is up, or it answered quickly that it is broken (not_ready / unreachable),
    // which is a real fault for the normal error paths, not a cold start. Only "waking" (inference
    // held by the host while it starts) or a gateway that is slow or failing keeps checking.
    let settled = false;
    try {
      const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(90_000) });
      const body = await res.json().catch(() => ({}));
      settled = res.ok && body.inference !== 'waking';
    } catch {
      /* gateway still starting or unreachable */
    }
    clearTimeout(slowTimer);
    if (settled || Date.now() > deadline) {
      warmupPending = false;
      update();
      return;
    }
    warmupPending = true;
    update();
    setTimeout(check, WARMUP_RETRY_MS);
  };
  check();
}
