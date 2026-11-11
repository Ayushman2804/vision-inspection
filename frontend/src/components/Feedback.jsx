import { useServerWaking, WAKING_MESSAGE } from '../wake.js';

/** Placeholder block. Inline by default so it takes the line height of the text it stands in for. */
export function Skeleton({ width = '100%', height, block = false, className = '' }) {
  return (
    <span
      className={`skeleton${block ? ' block' : ''} ${className}`}
      style={{ width, height }}
      aria-hidden="true"
    >
      {block ? null : ' '}
    </span>
  );
}

/**
 * Error message with a Retry button for retryable errors (network/server). A 401 is not
 * retryable: the API client has already signed the user out and the login page replaces this.
 */
export function ErrorNotice({ error, onRetry, busy = false, children }) {
  if (!error) return null;
  const retryable = error.retryable !== false;
  return (
    <div className="error row between" role="alert">
      <span>
        {children ? `${children} ` : ''}
        {error.message}
      </span>
      {retryable && onRetry && (
        <button type="button" className="secondary small" onClick={onRetry} disabled={busy}>
          {busy ? 'Retrying…' : 'Retry'}
        </button>
      )}
    </div>
  );
}

/** `small` fits inside a button or a line of text. */
export function Spinner({ label = 'Loading', small = false }) {
  return <span className={`spinner${small ? ' small' : ''}`} role="status" aria-label={label} />;
}

/** App-wide notice while the hosted server wakes from idle (see wake.js). Renders nothing locally. */
export function WakeNotice() {
  const waking = useServerWaking();
  if (!waking) return null;
  return (
    <div className="wake-notice" role="status">
      <Spinner small label="Waking" /> {WAKING_MESSAGE}
    </div>
  );
}
