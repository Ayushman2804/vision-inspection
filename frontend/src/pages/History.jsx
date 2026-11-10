import { useState } from 'react';
import { api, apiBase } from '../api.js';
import { ErrorNotice, Skeleton } from '../components/Feedback.jsx';
import { CLASS_NAMES, colorFor } from '../draw.js';
import { useLiveQuery } from '../useLiveQuery.js';

const PAGE = 15;
const COLUMNS = ['#', 'Time', 'Source', 'Result', 'Defects', 'Latency', 'Image'];

export default function History() {
  const [filters, setFilters] = useState({ status: '', class: '', source: '' });
  const [offset, setOffset] = useState(0);
  // Refetches on filter/page change, on window focus, and (throttled) when Upload or Live store
  // a new inspection. Rows come only from the server, never inserted optimistically.
  const { data, error, loading, refreshing, retry } = useLiveQuery(
    (signal) => api.history({ ...filters, limit: PAGE, offset }, { signal }),
    [filters, offset],
  );
  const total = data?.total ?? 0;
  const items = data?.items ?? [];

  const set = (key) => (e) => {
    setOffset(0);
    setFilters({ ...filters, [key]: e.target.value });
  };

  return (
    <section className="card">
      <div className="row">
        <h2>Inspection history</h2>
        <span className={`refresh-dot${refreshing && !loading ? ' on' : ''}`} title="Refreshing" aria-hidden="true" />
      </div>
      <div className="row">
        <select value={filters.status} onChange={set('status')} aria-label="Result">
          <option value="">All results</option>
          <option value="pass">Pass</option>
          <option value="fail">Fail</option>
        </select>
        <select value={filters.class} onChange={set('class')} aria-label="Defect class">
          <option value="">All defect classes</option>
          {CLASS_NAMES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select value={filters.source} onChange={set('source')} aria-label="Source">
          <option value="">All sources</option>
          <option value="upload">Upload</option>
          <option value="video">Video</option>
        </select>
      </div>
      {error && (
        <ErrorNotice error={error} onRetry={retry} busy={refreshing}>
          {data ? 'Could not refresh; showing the last results.' : 'Could not load history.'}
        </ErrorNotice>
      )}
      {/* Below 640px the table restyles into one card per row (see .history-table in styles.css). */}
      <table className="history-table">
        <thead>
          <tr>
            {COLUMNS.map((c) => (
              <th key={c}>{c === 'Image' ? <span className="sr-only">Image</span> : c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && Array.from({ length: PAGE }, (_, k) => <SkeletonRow key={k} />)}
          {!loading &&
            items.map((i) => (
              <tr key={i.id}>
                <td data-label="#">{i.id}</td>
                <td data-label="Time">{new Date(i.created_at).toLocaleString()}</td>
                <td data-label="Source">{i.source}</td>
                <td data-label="Result">
                  <span className={`badge ${i.status}`}>{i.status}</span>
                </td>
                <td data-label="Defects">
                  {i.defects.length === 0 && <span className="muted">none</span>}
                  {i.defects.map((d, k) => (
                    <span key={k} className="chip" style={{ borderColor: colorFor(d.class_name) }}>
                      {d.class_name} {(d.confidence * 100).toFixed(0)}%
                    </span>
                  ))}
                </td>
                <td data-label="Latency">{i.latency_ms?.toFixed(0)} ms</td>
                <td data-label="Image" className="thumb-cell">
                  {i.image_url ? (
                    <a href={`${apiBase}${i.image_url}`} target="_blank" rel="noreferrer">
                      <img className="thumb" src={`${apiBase}${i.image_url}`} alt={`Inspection ${i.id}`} />
                    </a>
                  ) : (
                    <span className="thumb" />
                  )}
                </td>
              </tr>
            ))}
          {!loading && data && items.length === 0 && (
            <tr className="empty">
              <td colSpan={COLUMNS.length} className="muted">
                No inspections match.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="row between">
        <span className="muted">
          {loading ? <Skeleton width="10ch" /> : total ? `${offset + 1}–${Math.min(offset + PAGE, total)} of ${total}` : '0 results'}
        </span>
        <div className="row">
          <button className="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
            Prev
          </button>
          <button className="secondary" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>
            Next
          </button>
        </div>
      </div>
    </section>
  );
}

/** Same cells and height as a real row (the 44px thumbnail sets the row height). */
function SkeletonRow() {
  const widths = ['3ch', '16ch', '5ch', '4.5ch', '14ch', '5ch'];
  return (
    <tr className="skeleton-row" aria-hidden="true">
      {widths.map((w, k) => (
        <td key={k} data-label={COLUMNS[k]}>
          <Skeleton width={w} />
        </td>
      ))}
      <td data-label="Image" className="thumb-cell">
        <Skeleton block className="thumb" />
      </td>
    </tr>
  );
}
