import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router';
import { getToken, setToken } from './api.js';
import Login from './pages/Login.jsx';

// Split per page so the chart library (Recharts) only loads with the Dashboard.
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const History = lazy(() => import('./pages/History.jsx'));
const Live = lazy(() => import('./pages/Live.jsx'));
const Upload = lazy(() => import('./pages/Upload.jsx'));

export default function App() {
  const [authed, setAuthed] = useState(Boolean(getToken()));

  useEffect(() => {
    const onLogout = () => setAuthed(false);
    window.addEventListener('auth:logout', onLogout);
    return () => window.removeEventListener('auth:logout', onLogout);
  }, []);

  if (!authed) return <Login onAuth={() => setAuthed(true)} />;

  return (
    <BrowserRouter>
      <header className="nav">
        <strong>Steel Defect Inspection</strong>
        <nav>
          <NavLink to="/" end>Dashboard</NavLink>
          <NavLink to="/live">Live video</NavLink>
          <NavLink to="/upload">Upload</NavLink>
          <NavLink to="/history">History</NavLink>
        </nav>
        <button
          className="secondary"
          onClick={() => {
            setToken(null);
            setAuthed(false);
          }}
        >
          Sign out
        </button>
      </header>
      <main>
        <Suspense fallback={<p className="muted">Loading…</p>}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/live" element={<Live />} />
            <Route path="/upload" element={<Upload />} />
            <Route path="/history" element={<History />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>
    </BrowserRouter>
  );
}
