import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

/**
 * "An inspection was just stored" signal. Upload and Live call notifyInspection() after the
 * gateway confirms an inspection; Dashboard and History refetch when lastInspectionAt changes
 * (throttled in useLiveQuery). It carries no data: pages always refetch from the server, so they
 * only ever show inspections that were actually stored.
 *
 * Only one page is mounted per tab, so the in-tab signal alone would rarely reach an open History
 * page. The signal is also broadcast to the app's other tabs (BroadcastChannel), which is what
 * makes "Live in one tab, History in another" stay in sync.
 */
const SignalValue = createContext(0);
const SignalNotify = createContext(() => {});

const CHANNEL = 'inspection-signal';

export function InspectionSignalProvider({ children }) {
  const [lastInspectionAt, setLastInspectionAt] = useState(0);
  const channel = useRef(null);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return undefined;
    const ch = new BroadcastChannel(CHANNEL);
    ch.onmessage = (e) => setLastInspectionAt(Number(e.data) || Date.now());
    channel.current = ch;
    return () => {
      ch.close();
      channel.current = null;
    };
  }, []);

  const notifyInspection = useCallback(() => {
    const t = Date.now();
    setLastInspectionAt(t);
    channel.current?.postMessage(t);
  }, []);

  // Two contexts so producers (Live, ~3 calls/s) don't re-render just because the value changed.
  return (
    <SignalNotify.Provider value={notifyInspection}>
      <SignalValue.Provider value={lastInspectionAt}>{children}</SignalValue.Provider>
    </SignalNotify.Provider>
  );
}

export const useLastInspectionAt = () => useContext(SignalValue);
export const useNotifyInspection = () => useContext(SignalNotify);
