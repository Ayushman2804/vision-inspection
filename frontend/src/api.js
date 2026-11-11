import { isWaking, SLOW_MS, trackSlow, WAKING_MESSAGE } from './wake.js';

const BASE = (import.meta.env.VITE_API_URL || 'http://localhost:4000').replace(/\/$/, '');

export const apiBase = BASE;
export const getToken = () => localStorage.getItem('token');
export const setToken = (t) => (t ? localStorage.setItem('token', t) : localStorage.removeItem('token'));

/**
 * Error from an API call. `status` is the HTTP status, or 0 when the request never got a
 * response (network down, gateway unreachable, CORS). `retryable` is false only for 401:
 * that case already signs the user out, so offering "Retry" would be pointless.
 */
export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.retryable = status !== 401;
  }
}

/** Statuses a sleeping host or a still-starting upstream produces (no response, bad gateway, unavailable, timeout). */
const COLD_STATUSES = new Set([0, 502, 503, 504]);

/**
 * Error for a failed response. When the failure looks like a cold start (a cold-type status while the
 * server is known to be waking, or after the request itself was slow), say so instead of a generic error.
 */
function apiError(message, status, startedAt) {
  if (COLD_STATUSES.has(status) && (isWaking() || performance.now() - startedAt > SLOW_MS)) {
    const e = new ApiError(WAKING_MESSAGE, status);
    e.waking = true;
    return e;
  }
  return new ApiError(message, status);
}

async function request(path, { method = 'GET', body, form, signal } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) {
    payload = form;
  } else if (body) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const startedAt = performance.now();
  let res;
  try {
    res = await trackSlow(fetch(`${BASE}${path}`, { method, headers, body: payload, signal }));
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw apiError('Could not reach the server. Check your connection.', 0, startedAt);
  }
  const data = await res.json().catch(() => ({}));
  signOutOn401(res, token);
  if (!res.ok) throw apiError(data.error || `Request failed (${res.status})`, res.status, startedAt);
  return data;
}

/** A 401 with a token means the session expired: drop it and send the app back to the login page. */
function signOutOn401(res, token) {
  if (res.status === 401 && token) {
    setToken(null);
    window.dispatchEvent(new Event('auth:logout'));
  }
}

/** Filename from a Content-Disposition header (RFC 6266 `filename*` or plain `filename`). */
function dispositionFilename(header) {
  if (!header) return null;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      /* fall through to the plain form */
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  return plain ? plain[1].trim() : null;
}

/**
 * Download the filtered history as CSV. Not routed through request(), which parses JSON:
 * reads the body as a blob and saves it through a temporary object URL.
 * Returns { truncated, rows } from the X-Truncated / X-Total-Rows headers.
 */
async function exportCsv(params = {}) {
  const token = getToken();
  const startedAt = performance.now();
  let res;
  try {
    res = await trackSlow(
      fetch(`${BASE}/api/inspections/export.csv?${qs(params)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }),
    );
  } catch {
    throw apiError('Could not reach the server. Check your connection.', 0, startedAt);
  }
  signOutOn401(res, token);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw apiError(data.error || `Export failed (${res.status})`, res.status, startedAt);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = dispositionFilename(res.headers.get('Content-Disposition')) || 'inspections.csv';
  document.body.append(a);
  a.click();
  a.remove();
  // Revoke after the click has handed the blob to the download (immediate revoke can cancel it in Firefox).
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return {
    truncated: res.headers.get('X-Truncated') === 'true',
    rows: Number(res.headers.get('X-Total-Rows')) || 0,
  };
}

const qs = (params) => {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => v !== '' && v != null && p.set(k, v));
  return p.toString();
};

export const api = {
  login: (email, password) => request('/api/auth/login', { method: 'POST', body: { email, password } }),
  register: (email, password) => request('/api/auth/register', { method: 'POST', body: { email, password } }),
  inspect(blob, { conf = 0.25, source = 'upload' } = {}) {
    const form = new FormData();
    form.append('conf', String(conf)); // text fields first so multer sees them
    form.append('source', source);
    form.append('image', blob, 'frame.jpg');
    return request('/api/inspect', { method: 'POST', form });
  },
  history: (params, opts) => request(`/api/inspections?${qs(params)}`, opts),
  inspection: (id, opts) => request(`/api/inspections/${encodeURIComponent(id)}`, opts),
  // 204 with an empty body: request() falls back to {}.
  deleteInspection: (id) => request(`/api/inspections/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  exportCsv,
  stats: (days, opts) => request(`/api/stats?days=${days}`, opts),
  alerts: (opts) => request('/api/alerts', opts),
};
