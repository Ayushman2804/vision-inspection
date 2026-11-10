import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router';
import { getToken, setToken } from './api.js';
import { DefectField, InspectFab } from './components/Chrome.jsx';
import { Spinner } from './components/Feedback.jsx';
import { IconCoil, IconDashboard, IconHistory, IconSignOut, IconUpload, IconVideo } from './components/Icons.jsx';
import { InspectionSignalProvider } from './inspectionSignal.jsx';
import Login from './pages/Login.jsx';

// Split per page so the chart library (Recharts) only loads with the Dashboard.
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const History = lazy(() => import('./pages/History.jsx'));
const Live = lazy(() => import('./pages/Live.jsx'));
const Upload = lazy(() => import('./pages/Upload.jsx'));

const NAV = [
  {
    group: 'Monitor',
    items: [
      { to: '/', label: 'Dashboard', icon: IconDashboard, end: true },
      { to: '/live', label: 'Live video', icon: IconVideo },
    ],
  },
  {
    group: 'Records',
    items: [
      { to: '/upload', label: 'Upload', icon: IconUpload },
      { to: '/history', label: 'History', icon: IconHistory },
    ],
  },
];

/** Email from the JWT payload, for display only (the server verifies the token). */
function signedInEmail() {
  try {
    const part = getToken()?.split('.')[1];
    return part ? JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))).email : '';
  } catch {
    return '';
  }
}

export default function App() {
  const [authed, setAuthed] = useState(Boolean(getToken()));

  useEffect(() => {
    const onLogout = () => setAuthed(false);
    window.addEventListener('auth:logout', onLogout);
    return () => window.removeEventListener('auth:logout', onLogout);
  }, []);

  if (!authed)
    return (
      <>
        <DefectField />
        <Login onAuth={() => setAuthed(true)} />
      </>
    );

  const email = signedInEmail();

  return (
    <InspectionSignalProvider>
      <BrowserRouter>
        <DefectField />
        <div className="shell">
          <aside className="sidebar">
            <div className="brand">
              <IconCoil size={26} />
              <span>
                Steel defect <br />
                inspection
              </span>
            </div>
            <nav aria-label="Main">
              {NAV.map(({ group, items }) => (
                <div className="nav-group" key={group}>
                  <span className="nav-group-label">{group}</span>
                  {items.map(({ to, label, icon: Icon, end }) => (
                    <NavLink key={to} to={to} end={end}>
                      <Icon size={18} />
                      <span>{label}</span>
                    </NavLink>
                  ))}
                </div>
              ))}
            </nav>
            <div className="account">
              {email && (
                <span className="account-email" title={email}>
                  {email}
                </span>
              )}
              <button
                className="secondary signout"
                onClick={() => {
                  setToken(null);
                  setAuthed(false);
                }}
              >
                <IconSignOut size={16} />
                <span>Sign out</span>
              </button>
            </div>
          </aside>
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
                <Route path="/history" element={<History />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </main>
        </div>
        <InspectFab />
      </BrowserRouter>
    </InspectionSignalProvider>
  );
}
