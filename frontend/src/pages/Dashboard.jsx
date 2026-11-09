import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api.js';

export default function Dashboard() {
  const [days, setDays] = useState(7);
  const [stats, setStats] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    const load = () =>
      Promise.all([api.stats(days), api.alerts()])
        .then(([s, a]) => {
          if (!alive) return;
          setStats(s);
          setAlerts(a.items);
          setError('');
        })
        .catch((e) => alive && setError(e.message));
    load();
    const id = setInterval(load, 10000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [days]);

  if (error) return <div className="error">{error}</div>;
  if (!stats) return <p className="muted">Loading…</p>;

  const t = stats.totals;
  const timeline = stats.timeline.map((p) => ({
    label: new Date(p.bucket).toLocaleString([], stats.unit === 'hour' ? { hour: '2-digit', minute: '2-digit' } : { month: 'short', day: 'numeric' }),
    Inspected: p.total,
    Defective: p.fails,
  }));

  return (
    <>
      <div className="row between">
        <h2>Overview</h2>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={1}>Last 24 hours</option>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
        </select>
      </div>

      <div className="grid four">
        <div className="card kpi">
          <span className="stat">{t.total}</span>
          <span className="muted">inspected</span>
        </div>
        <div className="card kpi">
          <span className="stat">{(t.defect_rate * 100).toFixed(1)}%</span>
          <span className="muted">defect rate</span>
        </div>
        <div className="card kpi">
          <span className="stat">{t.passes}</span>
          <span className="muted">passed</span>
        </div>
        <div className="card kpi">
          <span className="stat">{t.avg_latency_ms} ms</span>
          <span className="muted">avg latency</span>
        </div>
      </div>

      <div className="grid two">
        <section className="card">
          <h3>Defects by class</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={stats.by_class} margin={{ bottom: 28 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis
                dataKey="class_name"
                interval={0}
                angle={-20}
                textAnchor="end"
                height={50}
                tick={{ fill: '#94a3b8', fontSize: 11 }}
              />
              <YAxis allowDecimals={false} tick={{ fill: '#94a3b8' }} />
              <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155' }} />
              <Bar dataKey="count" fill="#38bdf8" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </section>

        <section className="card">
          <h3>Throughput and defects over time</h3>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={timeline}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fill: '#94a3b8' }} />
              <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155' }} />
              {/* Recharts 3 sorts legend items alphabetically by default; keep the series order. */}
              <Legend itemSorter={null} />
              <Line type="monotone" dataKey="Inspected" stroke="#38bdf8" dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="Defective" stroke="#f87171" dot={false} strokeWidth={2} />
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
