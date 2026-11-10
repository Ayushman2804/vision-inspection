import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLastInspectionAt } from './inspectionSignal.jsx';

/** Background refetches (poll, focus, new-inspection signal) start at most this often. */
export const MIN_REFETCH_GAP_MS = 4000;

/**
 * Fetch data for a page and keep it fresh.
 *
 * - `loading` is true only until the first response (success or error) for the current page
 *   mount. Background refreshes never set it again, so skeletons never flash on a poll.
 * - `refreshing` is true while any request is in flight, for a subtle indicator.
 * - Background triggers (poll every `pollMs`, window focus, a new inspection anywhere in the app)
 *   are throttled to one start per MIN_REFETCH_GAP_MS, never overlap an in-flight request, and
 *   coalesce into a single trailing refetch.
 * - A change in `deps` (filters, page, range) fetches immediately and drops any older response.
 * - `retry()` refetches now; `error` keeps the last error (an ApiError with `retryable`).
 *
 * `fetcher(signal)` must return a promise and should pass `signal` to the API call.
 */
export function useLiveQuery(fetcher, deps, { pollMs } = {}) {
  const lastInspectionAt = useLastInspectionAt();
  const [state, setState] = useState({ data: null, error: null, loading: true, refreshing: false });

  const fetcherRef = useRef(fetcher);
  useLayoutEffect(() => {
    fetcherRef.current = fetcher;
  });

  // Mutable controller shared by all triggers; never causes renders on its own.
  const ctl = useRef(null);
  if (!ctl.current) {
    const c = { inFlight: null, pending: false, timer: null, lastStart: 0, gen: 0, alive: false };
    c.run = () => {
      const gen = c.gen;
      const ac = new AbortController();
      c.inFlight = ac;
      c.pending = false;
      c.lastStart = Date.now();
      setState((s) => (s.refreshing ? s : { ...s, refreshing: true }));
      Promise.resolve()
        .then(() => fetcherRef.current(ac.signal))
        .then(
          (data) => {
            if (gen === c.gen) setState({ data, error: null, loading: false, refreshing: false });
          },
          (error) => {
            if (error?.name === 'AbortError' || gen !== c.gen) return;
            setState((s) => ({ ...s, error, loading: false, refreshing: false }));
          },
        )
        .finally(() => {
          if (c.inFlight !== ac) return; // superseded by a deps change
          c.inFlight = null;
          if (c.pending && c.alive) c.request();
        });
    };
    // Throttled, non-overlapping trigger used by poll / focus / signal.
    c.request = () => {
      if (!c.alive) return;
      if (c.inFlight) {
        c.pending = true;
        return;
      }
      if (c.timer) return;
      const wait = c.lastStart + MIN_REFETCH_GAP_MS - Date.now();
      if (wait <= 0) c.run();
      else
        c.timer = setTimeout(() => {
          c.timer = null;
          c.request();
        }, wait);
    };
    c.reset = () => {
      c.gen += 1;
      c.inFlight?.abort();
      c.inFlight = null;
      c.pending = false;
      clearTimeout(c.timer);
      c.timer = null;
    };
    ctl.current = c;
  }

  // Immediate fetch on mount and whenever deps change.
  useEffect(() => {
    const c = ctl.current;
    c.alive = true;
    c.reset();
    c.run();
    return () => {
      c.alive = false;
      c.reset();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // Background triggers.
  useEffect(() => {
    const c = ctl.current;
    const onFocus = () => c.request();
    window.addEventListener('focus', onFocus);
    const id = pollMs ? setInterval(() => !document.hidden && c.request(), pollMs) : null;
    return () => {
      window.removeEventListener('focus', onFocus);
      if (id) clearInterval(id);
    };
  }, [pollMs]);

  const firstSignal = useRef(lastInspectionAt);
  useEffect(() => {
    if (lastInspectionAt !== firstSignal.current) ctl.current.request();
  }, [lastInspectionAt]);

  const retry = useCallback(() => {
    const c = ctl.current;
    if (c.inFlight) return;
    clearTimeout(c.timer);
    c.timer = null;
    c.run();
  }, []);

  return { ...state, retry };
}
