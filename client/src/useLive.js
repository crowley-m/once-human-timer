import { useEffect, useRef, useState } from 'react';

/**
 * Subscribe to the server's SSE stream. Fires the given handlers as events
 * arrive and auto-reconnects. Returns the connection status:
 *   'connecting' | 'live' | 'offline'
 *
 * Handlers are read through a ref so changing them doesn't tear down the
 * EventSource.
 */
export function useLive({ onZone, onZoneDeleted, onActivity, onActivityCleared, onResync } = {}) {
  const [status, setStatus] = useState('connecting');
  const h = useRef({});
  h.current = { onZone, onZoneDeleted, onActivity, onActivityCleared, onResync };

  useEffect(() => {
    if (typeof EventSource === 'undefined') {
      setStatus('offline');
      return;
    }

    let es;
    let retry;
    let stopped = false;
    let everOpen = false;

    const connect = () => {
      es = new EventSource('/api/stream');

      es.onopen = () => {
        setStatus('live');
        // a reconnect means we may have missed events — let the app refetch
        if (everOpen) h.current.onResync?.();
        everOpen = true;
      };
      es.addEventListener('zone', (e) => {
        try {
          h.current.onZone?.(JSON.parse(e.data));
        } catch {
          /* ignore malformed */
        }
      });
      es.addEventListener('zone-deleted', (e) => {
        try {
          h.current.onZoneDeleted?.(JSON.parse(e.data).id);
        } catch {
          /* ignore */
        }
      });
      es.addEventListener('activity', (e) => {
        try {
          h.current.onActivity?.(JSON.parse(e.data));
        } catch {
          /* ignore */
        }
      });
      es.addEventListener('activity-cleared', (e) => {
        try {
          h.current.onActivityCleared?.(JSON.parse(e.data));
        } catch {
          h.current.onActivityCleared?.({});
        }
      });
      es.onerror = () => {
        es.close();
        if (stopped) return;
        setStatus('connecting');
        retry = setTimeout(connect, 3000);
      };
    };

    connect();

    return () => {
      stopped = true;
      clearTimeout(retry);
      es?.close();
    };
  }, []);

  return status;
}
