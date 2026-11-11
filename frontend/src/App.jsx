import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router';
import { apiBase, getToken, setToken } from './api.js';
import { Spinner, WakeNotice } from './components/Feedback.jsx';
import { InspectionSignalProvider } from './inspectionSignal.jsx';
import Login from './pages/Login.jsx';
import { warmUp } from './wake.js';

// Split per page so the chart library (Recharts) only loads with the Dashboard.
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const History = lazy(() => import('./pages/History.jsx'));
const Live = lazy(() => import('./pages/Live.jsx'));
const Upload = lazy(() => import('./pages/Upload.jsx'));

export default function App() {
  const [authed, setAuthed] = useState(Boolean(getToken()));

  // Wake gateway and inference as soon as the app opens (hosted free tiers sleep when idle).
  useEffect(() => warmUp(apiBase), []);

  useEffect(() => {
    const onLogout = () => setAuthed(false);
    window.addEventListener('auth:logout', onLogout);
    return () => window.removeEventListener('auth:logout', onLogout);
  }, []);

  if (!authed)
    return (
      <>
        <WakeNotice />
        <Login onAuth={() => setAuthed(true)} />
      </>
    );

  return (
    <InspectionSignalProvider>
      <BrowserRouter>
        <WakeNotice />
        <header className="nav">
          <strong className="brand">Steel Defect Inspection</strong>
          <nav>
            <NavLink to="/" end>Dashboard</NavLink>
            <NavLink to="/live">Live video</NavLink>
            <NavLink to="/upload">Upload</NavLink>
            <NavLink to="/history">History</NavLink>
          </nav>
          <button
            className="secondary signout"
            onClick={() => {
              setToken(null);
              setAuthed(false);
            }}
          >
            Sign out
          </button>
        </header>
        <main>
          <Suspense
            fallback={
              <div className="page-loading">
                <Spinner label="Loading page" />
              </div>
            }
          >
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/live" element={<Live />} />
              <Route path="/upload" element={<Upload />} />
              {/* Optional :id opens the detail dialog over the list, so the list keeps its filters and page. */}
              <Route path="/history/:id?" element={<History />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </main>
      </BrowserRouter>
    </InspectionSignalProvider>
  );
}
