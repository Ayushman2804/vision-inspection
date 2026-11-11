import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { api, apiBase } from '../api.js';
import { ErrorNotice, Skeleton, Spinner } from '../components/Feedback.jsx';
import { CLASS_NAMES, colorFor } from '../draw.js';
import { useNotifyInspection } from '../inspectionSignal.jsx';
import { useLiveQuery } from '../useLiveQuery.js';

const InspectionDetail = lazy(() => import('./InspectionDetail.jsx'));

const PAGE = 15;
const COLUMNS = ['#', 'Time', 'Source', 'Result', 'Defects', 'Latency', 'Image'];

/** Local midnight of a <input type="date"> value, plus `addDays`, as an ISO string ('' when unset). */
function dayStartIso(value, addDays = 0) {
  if (!value) return '';
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d + addDays).toISOString();
}

/** Query params for the list and the CSV export. "To" is inclusive for the user: send the next day's 00:00. */
function toParams(f) {
  return {
    status: f.status,
    class: f.class,
    source: f.source,
    from: dayStartIso(f.from),
    to: dayStartIso(f.to, 1),
  };
}

export default function History() {
  const { id: openId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const notifyInspection = useNotifyInspection();

  const [filters, setFilters] = useState({ status: '', class: '', source: '', from: '', to: '' });
  const [offset, setOffset] = useState(0);
  // Deleted here but possibly still in the last response: { id, at } so a response fetched after
  // the delete no longer counts it.
  const [removed, setRemoved] = useState([]);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState(null);
  const [exportError, setExportError] = useState(null);

  // Refetches on filter/page change, on window focus, and (throttled) when an inspection is stored
  // or deleted anywhere in the app. Rows come only from the server, never inserted optimistically.
  const { data, error, loading, refreshing, retry } = useLiveQuery(
    (signal) => {
      const startedAt = Date.now();
      return api
        .history({ ...toParams(filters), limit: PAGE, offset }, { signal })
        .then((res) => ({ ...res, startedAt }));
    },
    [filters, offset],
  );

  const stale = removed.filter((r) => data && r.at > data.startedAt).map((r) => r.id);
  const items = (data?.items ?? []).filter((i) => !stale.includes(i.id));
  const total = Math.max(0, (data?.total ?? 0) - ((data?.items.length ?? 0) - items.length));

  // Deleting the last row of a page leaves it empty after the refetch: step back a page.
  useEffect(() => {
    if (data && data.items.length === 0 && offset > 0 && data.total > 0) {
      setOffset(Math.max(0, Math.floor((data.total - 1) / PAGE) * PAGE));
    }
  }, [data, offset]);

  const set = (key) => (e) => {
    setOffset(0);
    setExportResult(null);
    setFilters({ ...filters, [key]: e.target.value });
  };

  async function runExport() {
    setExporting(true);
    setExportError(null);
    setExportResult(null);
    try {
      setExportResult(await api.exportCsv(toParams(filters)));
    } catch (e) {
      setExportError(e);
    } finally {
      setExporting(false);
    }
  }

  const open = (id) => navigate(`/history/${id}`, { state: { fromList: true } });
  const closeDetail = () => {
    if (location.state?.fromList) navigate(-1);
    else navigate('/history', { replace: true });
  };
  const onDeleted = (id) => {
    setRemoved((r) => [...r, { id, at: Date.now() }]);
    notifyInspection(); // Dashboard and other tabs refetch; so does this list
    closeDetail();
  };

  return (
    <section className="card">
      <div className="row between">
        <div className="row">
          <h2>Inspection history</h2>
          <span className={`refresh-dot${refreshing && !loading ? ' on' : ''}`} title="Refreshing" aria-hidden="true" />
        </div>
        <button type="button" className="secondary" onClick={runExport} disabled={exporting} aria-busy={exporting}>
          {exporting ? (
            <span className="row tight">
              <Spinner small label="Exporting" /> Exporting…
            </span>
          ) : (
            'Export CSV'
          )}
        </button>
      </div>
      <div className="row filters">
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
        <label className="date-field">
          <span className="muted">From</span>
          <input type="date" value={filters.from} max={filters.to || undefined} onChange={set('from')} />
        </label>
        <label className="date-field">
          <span className="muted">To</span>
          <input type="date" value={filters.to} min={filters.from || undefined} onChange={set('to')} />
        </label>
      </div>
      {exportError && (
        <ErrorNotice error={exportError} onRetry={runExport} busy={exporting}>
          Export failed.
        </ErrorNotice>
      )}
      {exportResult &&
        (exportResult.truncated ? (
          <p className="muted warn" role="status">
            The export stopped at the newest {exportResult.rows.toLocaleString()} rows; more matched. Narrow the
            dates or filters to export the rest.
          </p>
        ) : (
          <p className="muted" role="status">
            Exported {exportResult.rows.toLocaleString()} {exportResult.rows === 1 ? 'row' : 'rows'}.
          </p>
        ))}
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
              // The whole row opens the detail; the # link is the keyboard and screen-reader way in.
              <tr
                key={i.id}
                className="clickable"
                onClick={(e) => {
                  if (!e.target.closest('a, button')) open(i.id);
                }}
              >
                <td data-label="#">
                  <Link to={`/history/${i.id}`} state={{ fromList: true }} aria-label={`Open inspection ${i.id}`}>
                    {i.id}
                  </Link>
                </td>
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
                    <img className="thumb" src={`${apiBase}${i.image_url}`} alt="" loading="lazy" />
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
          {loading ? <Skeleton width="10ch" /> : total ? `${offset + 1}–${Math.min(offset + items.length, total)} of ${total}` : '0 results'}
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
      {openId && (
        <Suspense fallback={null}>
          <InspectionDetail key={openId} id={openId} onClose={closeDetail} onDeleted={onDeleted} />
        </Suspense>
      )}
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
