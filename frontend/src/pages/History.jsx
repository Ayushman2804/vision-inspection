import { useEffect, useState } from 'react';
import { api, apiBase } from '../api.js';
import { CLASS_NAMES, colorFor } from '../draw.js';

const PAGE = 15;

export default function History() {
  const [filters, setFilters] = useState({ status: '', class: '', source: '' });
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState({ total: 0, items: [] });
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .history({ ...filters, limit: PAGE, offset })
      .then((d) => {
        setData(d);
        setError('');
      })
      .catch((e) => setError(e.message));
  }, [filters, offset]);

  const set = (key) => (e) => {
    setOffset(0);
    setFilters({ ...filters, [key]: e.target.value });
  };

  return (
    <section className="card">
      <h2>Inspection history</h2>
      <div className="row">
        <select value={filters.status} onChange={set('status')}>
          <option value="">All results</option>
          <option value="pass">Pass</option>
          <option value="fail">Fail</option>
        </select>
        <select value={filters.class} onChange={set('class')}>
          <option value="">All defect classes</option>
          {CLASS_NAMES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select value={filters.source} onChange={set('source')}>
          <option value="">All sources</option>
          <option value="upload">Upload</option>
          <option value="video">Video</option>
        </select>
      </div>
      {error && <div className="error">{error}</div>}
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Time</th>
            <th>Source</th>
            <th>Result</th>
            <th>Defects</th>
            <th>Latency</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data.items.map((i) => (
            <tr key={i.id}>
              <td>{i.id}</td>
              <td>{new Date(i.created_at).toLocaleString()}</td>
              <td>{i.source}</td>
              <td>
                <span className={`badge ${i.status}`}>{i.status}</span>
              </td>
              <td>
                {i.defects.map((d, k) => (
                  <span key={k} className="chip" style={{ borderColor: colorFor(d.class_name) }}>
                    {d.class_name} {(d.confidence * 100).toFixed(0)}%
                  </span>
                ))}
              </td>
              <td>{i.latency_ms?.toFixed(0)} ms</td>
              <td>
                {i.image_url && (
                  <a href={`${apiBase}${i.image_url}`} target="_blank" rel="noreferrer">
                    <img className="thumb" src={`${apiBase}${i.image_url}`} alt="" />
                  </a>
                )}
              </td>
            </tr>
          ))}
          {data.items.length === 0 && (
            <tr>
              <td colSpan="7" className="muted">
                No inspections yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="row between">
        <span className="muted">
          {data.total ? `${offset + 1}–${Math.min(offset + PAGE, data.total)} of ${data.total}` : '0 results'}
        </span>
        <div className="row">
          <button className="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
            Prev
          </button>
          <button className="secondary" disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>
            Next
          </button>
        </div>
      </div>
    </section>
  );
}
