import { useEffect, useRef, useState } from 'react';
import { api, apiBase } from '../api.js';
import BBoxCanvas from '../components/BBoxCanvas.jsx';
import { ErrorNotice, Skeleton, Spinner } from '../components/Feedback.jsx';
import { colorFor } from '../draw.js';
import { useLiveQuery } from '../useLiveQuery.js';

/**
 * One inspection in a modal over the History list (route /history/:id). Native <dialog>: focus is
 * trapped and Esc closes it. Deleting asks first, because it removes the row and the stored image.
 */
export default function InspectionDetail({ id, onClose, onDeleted }) {
  const ref = useRef(null);
  const { data, error, loading, refreshing, retry } = useLiveQuery((signal) => api.inspection(id, { signal }), [id]);
  // A 404 wins over stale data: the inspection was deleted (maybe in another tab) or isn't yours.
  const notFound = error?.status === 404;
  const item = notFound ? null : data;

  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const [imageMissing, setImageMissing] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog.open) dialog.showModal();
    return () => dialog.open && dialog.close();
  }, []);

  async function remove() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteInspection(id);
    } catch (e) {
      // Already gone counts as deleted; anything else stays open with the error.
      if (e.status !== 404) {
        setDeleteError(e);
        setDeleting(false);
        return;
      }
    }
    onDeleted(Number(id));
  }

  return (
    <dialog
      ref={ref}
      className="detail-dialog"
      aria-labelledby="detail-title"
      onCancel={(e) => {
        e.preventDefault(); // close through the route, not just the element
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()} // backdrop
    >
      <div className="detail">
        <div className="row between">
          <h2 id="detail-title">Inspection #{id}</h2>
          <button type="button" className="secondary small" onClick={onClose}>
            Close
          </button>
        </div>

        {loading && <DetailSkeleton />}

        {notFound && (
          <div className="notice" role="alert">
            <p>This inspection doesn't exist or isn't yours. It may have been deleted.</p>
            <button type="button" className="secondary small" onClick={onClose}>
              Back to history
            </button>
          </div>
        )}

        {error && !notFound && (
          <ErrorNotice error={error} onRetry={retry} busy={refreshing}>
            {item ? 'Could not refresh this inspection.' : 'Could not load this inspection.'}
          </ErrorNotice>
        )}

        {item && (
          <>
            <div className="detail-grid">
              <div className="detail-media">
                {item.image_url && !imageMissing ? (
                  <BBoxCanvas
                    src={`${apiBase}${item.image_url}`}
                    detections={item.defects}
                    onError={() => setImageMissing(true)}
                  />
                ) : (
                  <p className="no-image muted">
                    {item.image_url
                      ? 'The stored image file is missing.'
                      : 'No image stored. Video frames keep their image only when a defect is found.'}
                  </p>
                )}
              </div>
              <dl className="meta">
                <dt>Result</dt>
                <dd>
                  <span className={`badge ${item.status}`}>{item.status}</span>
                </dd>
                <dt>Time</dt>
                <dd>{new Date(item.created_at).toLocaleString()}</dd>
                <dt>Source</dt>
                <dd>{item.source}</dd>
                <dt>Latency</dt>
                <dd>{item.latency_ms?.toFixed(0)} ms</dd>
                <dt>Model</dt>
                <dd className="break">{item.model_version}</dd>
                {item.image_url && !imageMissing && (
                  <>
                    <dt>Image</dt>
                    <dd>
                      <a href={`${apiBase}${item.image_url}`} target="_blank" rel="noreferrer">
                        Open original
                      </a>
                    </dd>
                  </>
                )}
              </dl>
            </div>

            <h3>
              {item.defects.length} {item.defects.length === 1 ? 'defect' : 'defects'}
            </h3>
            {item.defects.length > 0 && (
              <table>
                <thead>
                  <tr>
                    <th>Class</th>
                    <th>Confidence</th>
                    <th>Area</th>
                  </tr>
                </thead>
                <tbody>
                  {item.defects.map((d, k) => (
                    <tr key={k}>
                      <td>
                        <span className="dot" style={{ background: colorFor(d.class_name) }} /> {d.class_name}
                      </td>
                      <td>{(d.confidence * 100).toFixed(1)}%</td>
                      <td>{d.area_pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="danger-zone">
              {!confirming ? (
                <button type="button" className="danger" onClick={() => setConfirming(true)}>
                  Delete inspection
                </button>
              ) : (
                <div className="confirm" role="group" aria-label="Confirm delete">
                  <p>
                    Delete inspection #{id}
                    {item.image_url ? ' and its stored image' : ''}? This can't be undone.
                  </p>
                  <div className="row">
                    <button type="button" className="danger" onClick={remove} disabled={deleting} autoFocus>
                      {deleting ? (
                        <span className="row tight">
                          <Spinner small label="Deleting" /> Deleting…
                        </span>
                      ) : (
                        'Delete'
                      )}
                    </button>
                    <button type="button" className="secondary" onClick={() => setConfirming(false)} disabled={deleting}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {deleteError && (
                <ErrorNotice error={deleteError} onRetry={remove} busy={deleting}>
                  Could not delete.
                </ErrorNotice>
              )}
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}

function DetailSkeleton() {
  return (
    <div className="detail-grid" aria-hidden="true">
      <Skeleton block className="detail-media-skeleton" />
      <div className="meta">
        {Array.from({ length: 5 }, (_, k) => (
          <Skeleton key={k} width={k % 2 ? '12ch' : '18ch'} />
        ))}
      </div>
    </div>
  );
}
