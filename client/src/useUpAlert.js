import { useEffect, useRef } from 'react';

function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ac = new Ctx();
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.connect(g);
    g.connect(ac.destination);
    o.type = 'sine';
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.22, ac.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.32);
    o.start();
    o.stop(ac.currentTime + 0.33);
    setTimeout(() => ac.close(), 600);
  } catch {
    /* autoplay policy — ignore */
  }
}

/** Ask the browser for notification permission. Returns 'granted' | 'denied' | 'default' | 'unsupported'. */
export async function requestNotifyPermission() {
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export function notify(title, body, tag) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body, tag, silent: false });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* ignore */
  }
}

/**
 * Beep + browser notification when a watched zone crosses into "up" (or within
 * `leadMin` of it) while the page is loaded.
 * @param watch  Set of zone ids to alert on. Empty set = alert on all.
 * @param leadMin  fire this many minutes before "up" too (0 = only at up)
 */
export function useUpAlert(zones, now, enabled, watch, leadMin = 0, zoneLeads = {}) {
  const prev = useRef(null); // null until first run — don't alert for the initial batch

  useEffect(() => {
    const watchAll = !watch || watch.size === 0;
    const cur = new Set();
    for (const z of zones) {
      if (z.interval_minutes == null || !z.last_reset_at) continue;
      if (!watchAll && !watch.has(z.id)) continue;
      const e = (now - Date.parse(z.last_reset_at)) / 60000;
      const remaining = z.interval_minutes - e;
      const lead = zoneLeads[z.id] != null ? Number(zoneLeads[z.id]) : leadMin;
      // "armed" window: from lead-before-up until 2x interval overdue
      if (remaining <= lead && e < z.interval_minutes * 2) cur.add(z.id);
    }

    if (prev.current && enabled) {
      const fresh = [...cur].filter((id) => !prev.current.has(id));
      if (fresh.length) {
        beep();
        for (const id of fresh) {
          const z = zones.find((x) => x.id === id);
          if (!z) continue;
          const rem = z.interval_minutes - (now - Date.parse(z.last_reset_at)) / 60000;
          const msg = rem > 0.5 ? `up in ~${Math.round(rem)} min` : 'reset window reached — go check';
          notify(`${z.name}`, msg, `zone-${id}`);
        }
      }
    }
    prev.current = cur;
  }, [zones, now, enabled, watch, leadMin, zoneLeads]);
}
