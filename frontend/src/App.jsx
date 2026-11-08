import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { getToken, setToken } from './api.js';
import Dashboard from './pages/Dashboard.jsx';
import History from './pages/History.jsx';
import Live from './pages/Live.jsx';
import Login from './pages/Login.jsx';
import Upload from './pages/Upload.jsx';

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
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/live" element={<Live />} />
          <Route path="/upload" element={<Upload />} />
          <Route path="/history" element={<History />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
