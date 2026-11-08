import { useEffect, useState } from 'react';
import { api, apiBase } from '../api.js';
import BBoxCanvas from '../components/BBoxCanvas.jsx';
import { colorFor } from '../draw.js';

export default function Upload() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [conf, setConf] = useState(0.25);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!file) return undefined;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function run() {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      setResult(await api.inspect(file, { conf, source: 'upload' }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid two">
      <section className="card">
        <h2>Inspect an image</h2>
        <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files[0] || null)} />
        <label className="row">
          Confidence threshold: <b>{conf.toFixed(2)}</b>
          <input type="range" min="0.05" max="0.95" step="0.05" value={conf} onChange={(e) => setConf(Number(e.target.value))} />
        </label>
        <button onClick={run} disabled={!file || busy}>
          {busy ? 'Analyzing…' : 'Run inspection'}
        </button>
        {error && <div className="error">{error}</div>}
        {preview && !result && <img className="preview" src={preview} alt="selected" />}
        {result && preview && <BBoxCanvas src={preview} detections={result.detections} />}
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
