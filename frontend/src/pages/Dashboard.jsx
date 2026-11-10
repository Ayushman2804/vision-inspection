import { useState } from 'react';
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api.js';
import { ErrorNotice, Skeleton } from '../components/Feedback.jsx';
import { IconBars, IconBell, IconCheck, IconDashboard, IconGauge, IconStack, IconTrend, IconWarning } from '../components/Icons.jsx';
import { useLiveQuery } from '../useLiveQuery.js';

const POLL_MS = 10000;
const BAR_HEIGHT = 280;
const LINE_HEIGHT = 280;
const C = { grid: '#2d343e', tick: '#8d97a5', bar: '#f38020', inspected: '#5aa9e6', defective: '#ef5b4c' };
const tooltipStyle = { background: '#1d2229', border: '1px solid #2d343e', borderRadius: 6 };

const KPI_ICONS = [
  [IconStack, 'info'],
  [IconWarning, 'fail'],
  [IconCheck, 'pass'],
  [IconGauge, ''],
];

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
      <div className="page-head">
        <div className="row">
          <h2 className="title">
            <IconDashboard size={22} />
            Overview
          </h2>
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

function Kpi({ value, label, icon: Icon, tone = '' }) {
  return (
    <div className="card kpi">
      <span className={`kpi-icon ${tone}`}>
        <Icon size={20} />
      </span>
      <span className="stat">{value}</span>
      <span className="muted">{label}</span>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <>
      <div className="grid four">
        {KPI_ICONS.map(([icon, tone], k) => (
          <Kpi key={k} icon={icon} tone={tone} value={<Skeleton width="4.5ch" />} label={<Skeleton width="9ch" />} />
        ))}
      </div>
      <div className="grid two">
        <section className="card">
          <h3 className="title">
            <IconBars size={18} />
            Defects by class
          </h3>
          <Skeleton block height={BAR_HEIGHT} />
        </section>
        <section className="card">
          <h3 className="title">
            <IconTrend size={18} />
            Throughput and defects over time
          </h3>
          <Skeleton block height={LINE_HEIGHT} />
        </section>
      </div>
      <section className="card">
        <h3 className="title">
          <IconBell size={18} />
          Alerts
        </h3>
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
        <Kpi icon={IconStack} tone="info" value={t.total} label="inspected" />
        <Kpi icon={IconWarning} tone="fail" value={`${(t.defect_rate * 100).toFixed(1)}%`} label="defect rate" />
        <Kpi icon={IconCheck} tone="pass" value={t.passes} label="passed" />
        <Kpi icon={IconGauge} value={`${t.avg_latency_ms} ms`} label="avg model latency" />
      </div>

      <div className="grid two">
        <section className="card">
          <h3 className="title">
            <IconBars size={18} />
            Defects by class
          </h3>
          {/* Horizontal bars: class names stay readable at phone width without angled labels. */}
          <ResponsiveContainer width="100%" height={BAR_HEIGHT}>
            <BarChart data={stats.by_class} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.grid} horizontal={false} />
              <XAxis type="number" allowDecimals={false} tick={{ fill: C.tick, fontSize: 11 }} />
              <YAxis type="category" dataKey="class_name" width={104} tick={{ fill: C.tick, fontSize: 12 }} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(148,163,184,0.08)' }} />
              <Bar dataKey="count" fill={C.bar} radius={[0, 4, 4, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </section>

        <section className="card">
          <h3 className="title">
            <IconTrend size={18} />
            Throughput and defects over time
          </h3>
          <ResponsiveContainer width="100%" height={LINE_HEIGHT}>
            <ComposedChart data={timeline} margin={{ top: 4, right: 12, bottom: 0, left: -12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.grid} />
              <XAxis dataKey="label" tick={{ fill: C.tick, fontSize: 11 }} minTickGap={16} />
              <YAxis allowDecimals={false} tick={{ fill: C.tick, fontSize: 11 }} />
              <Tooltip contentStyle={tooltipStyle} />
              {/* Recharts 3 sorts legend items alphabetically by default; keep the series order. */}
              <Legend itemSorter={null} />
              {/* Inspected as a filled area so it stays visible when every inspection is a defect. */}
              <Area type="monotone" dataKey="Inspected" stroke={C.inspected} fill={C.inspected} fillOpacity={0.14} strokeWidth={2} isAnimationActive={false} />
              <Line type="monotone" dataKey="Defective" stroke={C.defective} dot={false} strokeWidth={2} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </section>
      </div>

      <section className="card">
        <h3 className="title">
          <IconBell size={18} />
          Alerts
        </h3>
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
