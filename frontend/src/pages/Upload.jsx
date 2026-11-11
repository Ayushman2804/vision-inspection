import { useEffect, useState } from 'react';
import { api, apiBase } from '../api.js';
import BBoxCanvas from '../components/BBoxCanvas.jsx';
import { ErrorNotice, Spinner } from '../components/Feedback.jsx';
import { colorFor } from '../draw.js';
import { useNotifyInspection } from '../inspectionSignal.jsx';
import { useServerWaking, WAKING_MESSAGE } from '../wake.js';

export default function Upload() {
  const waking = useServerWaking();
  const notifyInspection = useNotifyInspection();
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [conf, setConf] = useState(0.25);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // The selected file and its preview survive a failure, so Retry re-sends the same image.
  async function run() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.inspect(file, { conf, source: 'upload' });
      setResult(res);
      notifyInspection(); // stored server-side; History/Dashboard refetch
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid two">
      <section className="card">
        <h2>Inspect an image</h2>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => {
            setFile(e.target.files[0] || null);
            setResult(null);
            setError(null);
          }}
        />
        <label className="row">
          Confidence threshold: <b>{conf.toFixed(2)}</b>
          <input type="range" min="0.05" max="0.95" step="0.05" value={conf} onChange={(e) => setConf(Number(e.target.value))} />
        </label>
        <button onClick={run} disabled={!file || busy}>
          {busy ? 'Analyzing…' : 'Run inspection'}
        </button>
        <ErrorNotice error={error} onRetry={run} busy={busy}>
          Inspection failed.
        </ErrorNotice>
        {preview && (
          <div className="media-wrap" aria-busy={busy}>
            {result ? (
              <BBoxCanvas src={preview} detections={result.detections} />
            ) : (
              <img className="preview" src={preview} alt="selected" />
            )}
            {busy && (
              <div className="busy-overlay">
                {waking ? <p className="waking-text">{WAKING_MESSAGE}</p> : <Spinner label="Analyzing" />}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Result</h2>
        {!result && <p className="muted">Upload a steel-surface image to see detections.</p>}
        {result && (
          <>
            <div className={`badge big ${result.inspection.status}`}>{result.inspection.status.toUpperCase()}</div>
            <p className="muted">
              {result.inspection.defect_count} defect(s) · {result.inspection.latency_ms} ms · model{' '}
              {result.inspection.model_version}
            </p>
            {result.inspection.image_url && (
              <a href={`${apiBase}${result.inspection.image_url}`} target="_blank" rel="noreferrer">
                Open stored original
              </a>
            )}
            <table>
              <thead>
                <tr>
                  <th>Class</th>
                  <th>Confidence</th>
                  <th>Area</th>
                </tr>
              </thead>
              <tbody>
                {result.detections.map((d, i) => (
                  <tr key={i}>
                    <td>
                      <span className="dot" style={{ background: colorFor(d.class_name) }} /> {d.class_name}
                    </td>
                    <td>{(d.confidence * 100).toFixed(1)}%</td>
                    <td>{d.area_pct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>
    </div>
  );
}
