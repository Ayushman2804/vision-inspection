const BASE = (import.meta.env.VITE_API_URL || 'http://localhost:4000').replace(/\/$/, '');

export const apiBase = BASE;
export const getToken = () => localStorage.getItem('token');
export const setToken = (t) => (t ? localStorage.setItem('token', t) : localStorage.removeItem('token'));

async function request(path, { method = 'GET', body, form } = {}) {
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
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token) {
    setToken(null);
    window.dispatchEvent(new Event('auth:logout'));
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
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
  history: (params) => request(`/api/inspections?${qs(params)}`),
  stats: (days) => request(`/api/stats?days=${days}`),
  alerts: () => request('/api/alerts'),
};
