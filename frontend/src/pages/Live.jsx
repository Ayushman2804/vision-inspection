import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { drawDetections } from '../draw.js';
import { useNotifyInspection } from '../inspectionSignal.jsx';

const FPS = 3; // frames sampled per second and sent for inference
const MAX_FAILURES = 3; // consecutive failed frames before sampling pauses
const FRAME_WIDTH = 640;

export default function Live() {
  const videoRef = useRef(null);
  const overlayRef = useRef(null);
  const captureRef = useRef(null);
  const inFlight = useRef(false);

  const [src, setSrc] = useState(null);
  const [conf, setConf] = useState(0.25);
  const [stats, setStats] = useState({ frames: 0, fails: 0, latency: 0, lastDetections: [] });
  const [alert, setAlert] = useState(null);
  const [error, setError] = useState(''); // video load errors
  const [failure, setFailure] = useState(null); // { error, count, paused } for inference calls
  const failures = useRef(0);
  const pausedRef = useRef(false);
  const notifyInspection = useNotifyInspection();

  useEffect(() => {
    captureRef.current = document.createElement('canvas');
  }, []);

  useEffect(() => {
    if (!src || !src.startsWith('blob:')) return undefined;
    return () => URL.revokeObjectURL(src);
  }, [src]);

  const tick = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.paused || video.ended || !video.videoWidth || inFlight.current || pausedRef.current) return;
    inFlight.current = true; // back-pressure: never queue more than one frame
    try {
      const cap = captureRef.current;
      cap.width = FRAME_WIDTH;
      cap.height = Math.round((video.videoHeight / video.videoWidth) * FRAME_WIDTH);
      cap.getContext('2d').drawImage(video, 0, 0, cap.width, cap.height);
      const blob = await new Promise((resolve) => cap.toBlob(resolve, 'image/jpeg', 0.8));
      const res = await api.inspect(blob, { conf, source: 'video' });

      const overlay = overlayRef.current;
      overlay.width = res.image.width;
      overlay.height = res.image.height;
      const ctx = overlay.getContext('2d');
      ctx.clearRect(0, 0, overlay.width, overlay.height);
      drawDetections(ctx, res.detections, 1.2);

      setStats((s) => {
        const frames = s.frames + 1;
        return {
          frames,
          fails: s.fails + (res.inspection.status === 'fail' ? 1 : 0),
          latency: s.latency + (res.inspection.latency_ms - s.latency) / frames,
          lastDetections: res.detections,
        };
      });
      if (res.alert) setAlert(res.alert);
      notifyInspection();
      failures.current = 0;
      setFailure((f) => (f ? null : f));
    } catch (e) {
      failures.current += 1;
      // Isolated failures are skipped; after MAX_FAILURES in a row, stop sampling and ask.
      // A 401 signs the user out (api.js), so there is nothing to resume.
      const paused = failures.current >= MAX_FAILURES && e.retryable !== false;
      setFailure({ error: e, count: failures.current, paused });
      if (paused) {
        pausedRef.current = true;
        videoRef.current?.pause();
      }
    } finally {
      inFlight.current = false;
    }
  }, [conf, notifyInspection]);

  function resume() {
    failures.current = 0;
    pausedRef.current = false;
    setFailure(null);
    videoRef.current?.play().catch(() => {});
  }

  useEffect(() => {
    const id = setInterval(tick, 1000 / FPS);
    return () => clearInterval(id);
  }, [tick]);

  useEffect(() => {
    if (!alert) return undefined;
    const id = setTimeout(() => setAlert(null), 8000);
    return () => clearTimeout(id);
  }, [alert]);

  function reset() {
    failures.current = 0;
    pausedRef.current = false;
    setFailure(null);
    setError('');
    setStats({ frames: 0, fails: 0, latency: 0, lastDetections: [] });
    const o = overlayRef.current;
    if (o) o.getContext('2d').clearRect(0, 0, o.width, o.height);
  }

  const rate = stats.frames ? ((stats.fails / stats.frames) * 100).toFixed(0) : 0;

  return (
    <div className="grid two">
      <section className="card">
        <h2>Live inspection (video)</h2>
        <div className="row">
          <label className="btn">
            Choose video
            <input
              type="file"
              accept="video/*"
              hidden
              onChange={(e) => {
                const f = e.target.files[0];
                if (f) {
                  setSrc(URL.createObjectURL(f));
                  reset();
                }
              }}
            />
          </label>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setSrc('/sample.mp4');
              reset();
            }}
          >
            Load sample
          </button>
        </div>
        <label className="row">
          Confidence: <b>{conf.toFixed(2)}</b>
          <input type="range" min="0.05" max="0.95" step="0.05" value={conf} onChange={(e) => setConf(Number(e.target.value))} />
        </label>

        <div className="video-wrap">
          <video
            ref={videoRef}
            src={src || undefined}
            controls
            loop
            muted
            playsInline
            onError={() => setError('Could not load the video. For the sample, add frontend/public/sample.mp4 (see README).')}
            onPlay={() => pausedRef.current && resume()}
          />
          <canvas ref={overlayRef} className="overlay" />
        </div>
        <p className="muted">
          Press play: {FPS} frames/sec are sampled in your browser and sent to the model. Frames with a defect are saved to History.
        </p>
        {error && <div className="error">{error}</div>}
        {failure?.paused && (
          <div className="error" role="alert">
            <strong>Sampling paused</strong> after {failure.count} failed frames in a row: {failure.error.message}
            <div className="row" style={{ marginTop: 8 }}>
              <button type="button" className="secondary small" onClick={resume}>
                Resume
              </button>
            </div>
          </div>
        )}
        {failure && !failure.paused && (
          <p className="muted warn">
            Frame failed ({failure.count}/{MAX_FAILURES}): {failure.error.message}. Retrying with the next frame.
          </p>
        )}
      </section>

      <section className="card">
        <h2>Live stats</h2>
        {alert && (
          <div className="alert-banner">
            High defect rate: {(alert.details.fail_rate * 100).toFixed(0)}% of the last {alert.details.window} inspections failed
          </div>
        )}
        <div className="stat-row">
          <div>
            <span className="stat">{stats.frames}</span>
            <span className="muted">frames</span>
          </div>
          <div>
            <span className="stat">{rate}%</span>
            <span className="muted">defect rate</span>
          </div>
          <div>
            <span className="stat">{stats.latency.toFixed(0)} ms</span>
            <span className="muted">avg model latency</span>
          </div>
        </div>
        <h3>Current frame</h3>
        {stats.lastDetections.length === 0 ? (
          <p className="muted">No defects in the latest frame.</p>
        ) : (
          <ul className="plain">
            {stats.lastDetections.map((d, i) => (
              <li key={i}>
                {d.class_name} — {(d.confidence * 100).toFixed(0)}%
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
