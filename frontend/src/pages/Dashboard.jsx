import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api.js';
import { ErrorNotice, Skeleton } from '../components/Feedback.jsx';
import { useLiveQuery } from '../useLiveQuery.js';

const POLL_MS = 10000;
const BAR_HEIGHT = 280;
const LINE_HEIGHT = 280;
const tooltipStyle = { background: '#0f172a', border: '1px solid #334155' };

function loadDashboard(days, signal) {
  return Promise.all([api.stats(days, { signal }), api.alerts({ signal })]).then(([stats, a]) => ({
    stats,
    alerts: a.items,
  }));
}

export default function Dashboard() {
  const [days, setDays] = useState(7);
  const { data, error, loading, refreshing, retry } = useLiveQuery((signal) => loadDashboard(days, signal), [days], {
    pollMs: POLL_MS,
  });

  return (
    <>
      <div className="row between">
        <div className="row">
          <h2>Overview</h2>
          {/* Background refreshes only show this dot; skeletons are for the first load. */}
          <span className={`refresh-dot${refreshing && !loading ? ' on' : ''}`} title="Refreshing" aria-hidden="true" />
        </div>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Time range">
          <option value={1}>Last 24 hours</option>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
        </select>
      </div>

      {error && (
        <ErrorNotice error={error} onRetry={retry} busy={refreshing}>
          {data ? 'Could not refresh; showing the last data.' : 'Could not load the dashboard.'}
        </ErrorNotice>
      )}

      {loading ? <DashboardSkeleton /> : data && <DashboardContent stats={data.stats} alerts={data.alerts} />}
    </>
  );
}

function Kpi({ value, label }) {
  return (
    <div className="card kpi">
      <span className="stat">{value}</span>
      <span className="muted">{label}</span>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <>
      <div className="grid four">
        {['inspected', 'defect rate', 'passed', 'avg latency'].map((label) => (
          <Kpi key={label} value={<Skeleton width="4.5ch" />} label={<Skeleton width="9ch" />} />
        ))}
      </div>
      <div className="grid two">
        <section className="card">
          <h3>Defects by class</h3>
          <Skeleton block height={BAR_HEIGHT} />
        </section>
        <section className="card">
          <h3>Throughput and defects over time</h3>
          <Skeleton block height={LINE_HEIGHT} />
        </section>
      </div>
      <section className="card">
        <h3>Alerts</h3>
        <p className="muted">
          <Skeleton width="60%" />
        </p>
      </section>
    </>
  );
}

function DashboardContent({ stats, alerts }) {
  const t = stats.totals;
  const hourly = stats.unit === 'hour';
  const timeline = stats.timeline.map((p) => ({
    label: new Date(p.bucket).toLocaleString([], hourly ? { hour: '2-digit', minute: '2-digit' } : { month: 'short', day: 'numeric' }),
    Inspected: p.total,
    Defective: p.fails,
  }));

  return (
    <>
      <div className="grid four">
        <Kpi value={t.total} label="inspected" />
        <Kpi value={`${(t.defect_rate * 100).toFixed(1)}%`} label="defect rate" />
        <Kpi value={t.passes} label="passed" />
        <Kpi value={`${t.avg_latency_ms} ms`} label="avg latency" />
      </div>

      <div className="grid two">
        <section className="card">
          <h3>Defects by class</h3>
          {/* Horizontal bars: class names stay readable at phone width without angled labels. */}
          <ResponsiveContainer width="100%" height={BAR_HEIGHT}>
            <BarChart data={stats.by_class} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
              <XAxis type="number" allowDecimals={false} tick={{ fill: '#94a3b8', fontSize: 11 }} />
              <YAxis type="category" dataKey="class_name" width={104} tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(148,163,184,0.08)' }} />
              <Bar dataKey="count" fill="#38bdf8" radius={[0, 4, 4, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </section>

        <section className="card">
          <h3>Throughput and defects over time</h3>
          <ResponsiveContainer width="100%" height={LINE_HEIGHT}>
            <LineChart data={timeline} margin={{ top: 4, right: 12, bottom: 0, left: -12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 11 }} minTickGap={16} />
              <YAxis allowDecimals={false} tick={{ fill: '#94a3b8', fontSize: 11 }} />
              <Tooltip contentStyle={tooltipStyle} />
              {/* Recharts 3 sorts legend items alphabetically by default; keep the series order. */}
              <Legend itemSorter={null} />
              <Line type="monotone" dataKey="Inspected" stroke="#38bdf8" dot={false} strokeWidth={2} isAnimationActive={false} />
              <Line type="monotone" dataKey="Defective" stroke="#f87171" dot={false} strokeWidth={2} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </section>
      </div>

      <section className="card">
        <h3>Alerts</h3>
        {alerts.length === 0 ? (
          <p className="muted">No alerts triggered.</p>
        ) : (
          <ul className="plain">
            {alerts.map((a) => (
              <li key={a.id}>
                <span className="badge fail">alert</span> {new Date(a.triggered_at).toLocaleString()} — {(a.details.fail_rate * 100).toFixed(0)}% of the last{' '}
                {a.details.window} inspections failed
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
