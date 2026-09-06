import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Toaster, toast } from 'sonner';
import {
  Activity,
  Bell,
  BellOff,
  ChevronDown,
  ClipboardPaste,
  LayoutGrid,
  LogOut,
  Maximize2,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  SlidersHorizontal,
  Star,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import { api } from './api.js';
import ZoneRow from './components/ZoneRow.jsx';
import AuthScreen from './components/AuthScreen.jsx';
import Wallboard from './components/Wallboard.jsx';
import AddZoneModal from './components/AddZoneModal.jsx';
import RosterModal from './components/RosterModal.jsx';
import PasteLogModal from './components/PasteLogModal.jsx';
import ProfileModal from './components/ProfileModal.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import BoardSettingsModal from './components/BoardSettingsModal.jsx';
import ActivityModal from './components/ActivityModal.jsx';
import QuickLogModal from './components/QuickLogModal.jsx';
import BackdateModal from './components/BackdateModal.jsx';
import Avatar from './components/Avatar.jsx';
import { useUpAlert, requestNotifyPermission, notify } from './useUpAlert.js';
import { useLive } from './useLive.js';
import { enablePush, disablePush, pushSupported } from './push.js';
import {
  LOCAL_TZ,
  MANILA_TZ,
  dualClock,
  elapsedMinutesSince,
  formatAgo,
  formatDuration,
  manilaOffsetLabel,
  nowIn,
  nowClockParts,
  sameAsManila,
  tzShort,
} from './time.js';

const REFRESH_MS = 60_000; // fallback reconcile — live updates arrive via SSE
const COLD_MS = 2 * 60 * 60 * 1000;
const NEAR_MIN = 5;

const TYPE_META = {
  red_card: { label: 'Red card rooms', short: '2h cycle' },
  elite: { label: 'Elite enemies', short: '1h cycle' },
  blue: { label: 'Blue card rooms', short: '1h cycle' },
};
const TYPE_ORDER = ['red_card', 'elite', 'blue'];
const FILTERS = [
  ['all', 'All'],
  ['red_card', 'Red'],
  ['elite', 'Elite'],
  ['blue', 'Blue'],
];

function readyRank(zone, nowMs) {
  const elapsed = elapsedMinutesSince(zone.last_reset_at, nowMs);
  if (elapsed == null) return { tier: 4, score: 0 };
  if (zone.interval_minutes == null) return { tier: 3, score: -elapsed };
  const remaining = zone.interval_minutes - elapsed;
  if (remaining > 0) return { tier: 1, score: remaining };
  if (-remaining <= zone.interval_minutes * 2) return { tier: 0, score: remaining };
  return { tier: 2, score: remaining };
}
const isVeryStale = (z, nowMs) => readyRank(z, nowMs).tier === 2;
const remainingOf = (z, nowMs) => {
  if (z.interval_minutes == null || !z.last_reset_at) return null;
  return z.interval_minutes - elapsedMinutesSince(z.last_reset_at, nowMs);
};

const lsGet = (k, d) => {
  try {
    return localStorage.getItem(k) ?? d;
  } catch {
    return d;
  }
};
const lsSet = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
};

const DEFAULT_PREFS = {
  timeMode: 'in',
  density: 'comfortable',
  notifyLead: 0,
  hideStale: false,
  showSource: true,
  watch: [],
  zoneLeads: {},
};

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = checking, null = anon
  const [board, setBoard] = useState({ name: 'Rift Timers', registration: 'open' });
  const [browsing, setBrowsing] = useState(false);
  const [viewProfile, setViewProfile] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [boardSettingsOpen, setBoardSettingsOpen] = useState(false);
  const [zones, setZones] = useState([]);
  const [loadState, setLoadState] = useState('loading');
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [watchOnly, setWatchOnly] = useState(false);
  const [viewMode, setViewMode] = useState(() => (lsGet('oh-view', 'rooms') === 'next' ? 'next' : 'rooms'));
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => new Set(JSON.parse(lsGet('oh-collapsed', '[]'))));
  const [wallboard, setWallboard] = useState(false);
  const [adding, setAdding] = useState(false);
  const [managing, setManaging] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [activity, setActivity] = useState([]);
  const [activityOpen, setActivityOpen] = useState(false);
  const [quickLogOpen, setQuickLogOpen] = useState(false);
  const [quickLogZone, setQuickLogZone] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [focusId, setFocusId] = useState(null);
  const [alertsOn, setAlertsOn] = useState(lsGet('oh-alerts', '0') === '1');
  const [now, setNow] = useState(Date.now());
  const [syncedAt, setSyncedAt] = useState(null);
  const justResetRef = useRef(new Set());
  const [, forceTick] = useState(0);

  const load = useCallback(async ({ silent } = {}) => {
    if (!silent) setLoadState((s) => (s === 'ready' ? s : 'loading'));
    try {
      const data = await api.listZones();
      setZones(data);
      setLoadState('ready');
      setError(null);
      setSyncedAt(Date.now());
    } catch (e) {
      setError(e.message);
      setLoadState((s) => (s === 'ready' ? s : 'error'));
    }
  }, []);

  useEffect(() => {
    api
      .me()
      .then((r) => {
        setUser(r.user);
        if (r.board) setBoard(r.board);
      })
      .catch(() => setUser(null));
  }, []);

  const prefs = useMemo(() => ({ ...DEFAULT_PREFS, ...(user?.prefs || {}) }), [user]);
  const watchSet = useMemo(() => new Set(prefs.watch || []), [prefs.watch]);
  const zoneLeads = useMemo(() => prefs.zoneLeads || {}, [prefs.zoneLeads]);

  useEffect(() => {
    try {
      document.body.dataset.density = prefs.density;
    } catch {
      /* ignore */
    }
  }, [prefs.density]);

  const savePrefs = useCallback(
    async (patch) => {
      if (!user) return;
      const { user: u } = await api.updateMe({ prefs: { ...prefs, ...patch } });
      setUser(u);
    },
    [user, prefs]
  );
  const toggleWatch = useCallback(
    (id) => {
      const w = new Set(prefs.watch || []);
      w.has(id) ? w.delete(id) : w.add(id);
      savePrefs({ watch: [...w] });
    },
    [prefs.watch, savePrefs]
  );
  const setZoneLead = useCallback(
    (id, minutes) => {
      const next = { ...(prefs.zoneLeads || {}) };
      if (minutes === (prefs.notifyLead ?? 0)) delete next[id];
      else next[id] = minutes;
      savePrefs({ zoneLeads: next });
    },
    [prefs.zoneLeads, prefs.notifyLead, savePrefs]
  );

  useEffect(() => {
    load();
    const id = setInterval(() => load({ silent: true }), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => lsSet('oh-alerts', alertsOn ? '1' : '0'), [alertsOn]);
  useEffect(() => lsSet('oh-view', viewMode), [viewMode]);
  useEffect(() => lsSet('oh-collapsed', JSON.stringify([...collapsed])), [collapsed]);
  useUpAlert(zones, now, alertsOn, watchSet, prefs.notifyLead, zoneLeads);

  useEffect(() => {
    api.activity().then(setActivity).catch(() => {});
  }, []);

  const menuRef = useRef(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const patchZone = (z) => setZones((zs) => zs.map((x) => (x.id === z.id ? z : x)));
  const upsertZone = (z) =>
    setZones((zs) => (zs.some((x) => x.id === z.id) ? zs.map((x) => (x.id === z.id ? z : x)) : [...zs, z]));

  const meNameRef = useRef(null);
  meNameRef.current = user?.display_name || null;
  const liveStatus = useLive({
    onZone: upsertZone,
    onZoneDeleted: (id) => setZones((zs) => zs.filter((x) => x.id !== id)),
    onActivity: (item) => {
      setActivity((a) => [item, ...a].slice(0, 60));
      if (item.by_name && item.by_name !== meNameRef.current) toast(`${item.by_name} logged ${item.zone}`);
    },
    onActivityCleared: ({ timers } = {}) => {
      setActivity([]);
      if (timers) load({ silent: true });
    },
    onResync: () => load({ silent: true }),
  });

  const clearActivity = useCallback(
    async (alsoTimers) => {
      const r = await api.clearActivity(alsoTimers);
      setActivity([]);
      if (alsoTimers) await load({ silent: true });
      toast.success(alsoTimers ? 'Log cleared and timers reset' : `Cleared ${r.cleared} log entries`);
    },
    [load]
  );

  const markJustReset = useCallback((id) => {
    justResetRef.current.add(id);
    forceTick((n) => n + 1);
    setTimeout(() => {
      justResetRef.current.delete(id);
      forceTick((n) => n + 1);
    }, 4000);
  }, []);

  const gate = useCallback(() => {
    if (!user) {
      setBrowsing(false);
      toast('Create an account or log in to do that');
      return true;
    }
    return false;
  }, [user]);

  const handleReset = useCallback(
    async (zone, payload) => {
      if (gate()) return;
      const prev = { reset_at: zone.last_reset_at, note: zone.last_reset_note };
      const updated = await api.resetZone(zone.id, payload);
      patchZone(updated);
      if (!payload?.reset_at) markJustReset(zone.id);
      toast.success(`${zone.name} — reset logged`, {
        action: prev.reset_at
          ? {
              label: 'Undo',
              onClick: async () => {
                const back = await api.resetZone(zone.id, {
                  reset_at: prev.reset_at,
                  note: prev.note || undefined,
                });
                patchZone(back);
                toast('Reset undone');
              },
            }
          : undefined,
      });
    },
    [gate, markJustReset]
  );

  const handleClaim = useCallback(
    async (zone) => {
      if (gate()) return;
      patchZone(await api.claimZone(zone.id));
      toast.success(`You're on ${zone.name}`);
    },
    [gate]
  );
  const handleUnclaim = useCallback(async (zone) => {
    patchZone(await api.unclaimZone(zone.id));
  }, []);
  const handleClearZone = useCallback(
    async (zone) => {
      if (gate()) return;
      patchZone(await api.clearZone(zone.id));
      toast(`${zone.name} — timer cleared`);
    },
    [gate]
  );

  const handleCreate = useCallback(async (data) => {
    const created = await api.createZone(data);
    setZones((zs) => [...zs, created]);
    setAdding(false);
    toast.success(`Added ${created.name}`);
  }, []);
  const handleUpdate = useCallback(async (id, data) => {
    const updated = await api.updateZone(id, data);
    patchZone(updated);
    toast.success('Zone updated');
  }, []);
  const handleDelete = useCallback(async (id, name) => {
    await api.deleteZone(id);
    setZones((zs) => zs.filter((z) => z.id !== id));
    toast(`Deleted ${name ?? 'zone'}`);
  }, []);

  const handleLogout = useCallback(async () => {
    await api.logout().catch(() => {});
    setUser(null);
    setBrowsing(true);
    setMenuOpen(false);
    toast('Logged out');
  }, []);

  const toggleAlerts = useCallback(async () => {
    if (alertsOn) {
      setAlertsOn(false);
      disablePush().catch(() => {});
      toast('Alerts off');
      return;
    }
    const perm = await requestNotifyPermission();
    setAlertsOn(true);
    if (perm === 'granted') {
      const pushed = user && pushSupported() ? await enablePush().catch(() => false) : false;
      toast.success(
        pushed
          ? 'Alerts on — pushed to this device even when the tab is closed'
          : 'Alerts on — notification when a zone goes up'
      );
      notify('Rift timer alerts on', 'This is a test notification.', 'test');
    } else if (perm === 'denied') {
      toast.warning('Pop-ups blocked — you still get a beep + tab flash. Allow notifications in browser settings.');
    } else {
      toast('Alerts on — beep + tab flash');
    }
  }, [alertsOn, user]);

  // --- derived -----------------------------------------------------------
  const stamp = Math.floor(now / 60_000) * 60_000;
  const q = query.trim().toLowerCase();
  const viewerTz = prefs.tz || LOCAL_TZ;
  const dualTz = !sameAsManila(viewerTz, now);
  const offset = manilaOffsetLabel(now, LOCAL_TZ);
  const isAdmin = user?.role === 'admin';

  const bySoonest = (a, b) => {
    const wa = watchSet.has(a.id) ? 0 : 1;
    const wb = watchSet.has(b.id) ? 0 : 1;
    if (wa !== wb) return wa - wb;
    const ra = readyRank(a, stamp);
    const rb = readyRank(b, stamp);
    if (ra.tier !== rb.tier) return ra.tier - rb.tier;
    if (ra.score !== rb.score) return ra.score - rb.score;
    return a.name.localeCompare(b.name);
  };

  const groups = useMemo(() => {
    const visible = filter === 'all' ? TYPE_ORDER : [filter];
    return visible.map((type) => ({
      type,
      meta: TYPE_META[type],
      zones: zones
        .filter((z) => z.type === type)
        .filter((z) => !q || z.name.toLowerCase().includes(q))
        .filter((z) => !watchOnly || watchSet.has(z.id))
        .sort(bySoonest),
    }));
  }, [zones, filter, q, watchOnly, stamp, watchSet]);

  // "Up next" — every zone in one list, soonest first, not-logged pushed to the end
  const nextList = useMemo(() => {
    const list = zones
      .filter((z) => filter === 'all' || z.type === filter)
      .filter((z) => !q || z.name.toLowerCase().includes(q))
      .filter((z) => !watchOnly || watchSet.has(z.id))
      .sort(bySoonest);
    return {
      live: list.filter((z) => z.last_reset_at && !isVeryStale(z, stamp)),
      rest: list.filter((z) => !z.last_reset_at || isVeryStale(z, stamp)),
    };
  }, [zones, filter, q, watchOnly, stamp, watchSet]);

  const upNow = useMemo(
    () =>
      zones
        .filter((z) => {
          const r = remainingOf(z, stamp);
          return r != null && r <= 0 && -r < z.interval_minutes * 2;
        })
        .sort((a, b) => remainingOf(a, stamp) - remainingOf(b, stamp)),
    [zones, stamp]
  );

  const upcoming = useMemo(
    () =>
      zones
        .map((z) => ({ z, r: remainingOf(z, stamp) }))
        .filter((x) => x.r != null && x.r > 0)
        .sort((a, b) => a.r - b.r)
        .slice(0, 4),
    [zones, stamp]
  );
  const nextUp = upcoming[0] || null;

  const watching = useMemo(
    () =>
      zones
        .filter((z) => watchSet.has(z.id))
        .map((z) => ({ z, r: remainingOf(z, stamp) }))
        .sort((a, b) => (a.r ?? 1e9) - (b.r ?? 1e9)),
    [zones, watchSet, stamp]
  );

  const newestReset = useMemo(
    () => Math.max(0, ...zones.map((z) => (z.last_reset_at ? Date.parse(z.last_reset_at) : 0))),
    [zones]
  );
  const cold = newestReset > 0 && now - newestReset > COLD_MS;

  const jumpTo = (id) => {
    setFilter('all');
    setWatchOnly(false);
    setQuery('');
    setSearchOpen(false);
    setActivityOpen(false);
    setFocusId(id);
  };
  const goOverview = () => {
    setFilter('all');
    setWatchOnly(false);
    setQuery('');
    setSearchOpen(false);
  };
  const togglePanel = (type) =>
    setCollapsed((s) => {
      const n = new Set(s);
      n.has(type) ? n.delete(type) : n.add(type);
      return n;
    });

  const shortName = (n) => n.replace(/ —.*/, '').replace(/ \(.*/, '');
  const remLabel = (r) => (r == null ? '—' : r <= 0 ? `${formatDuration(-r)}` : formatDuration(r));
  const remClass = (r) => (r == null ? '' : r <= 0 ? 'is-up' : r <= NEAR_MIN ? 'is-near' : '');

  if (user === undefined)
    return (
      <div className="app">
        <p className="note" style={{ padding: 24 }}>
          loading…
        </p>
      </div>
    );
  if (!user && !browsing) {
    return (
      <AuthScreen
        board={board}
        onAuthed={(u, b) => {
          setUser(u);
          if (b) setBoard(b);
        }}
        onBrowse={() => setBrowsing(true)}
      />
    );
  }
  if (wallboard) {
    return <Wallboard zones={zones} now={now} viewerTz={viewerTz} onExit={() => setWallboard(false)} />;
  }

  const clk = nowClockParts(now, viewerTz);
  const [clockH, clockM] = clk.hm.split(':');
  const clockSecs = new Date(now).getSeconds();

  const renderRow = (zone) => (
    <ZoneRow
      key={zone.id}
      zone={zone}
      now={now}
      me={user?.display_name}
      isAdmin={isAdmin}
      timeMode={prefs.timeMode}
      viewerTz={viewerTz}
      showSource={prefs.showSource}
      watched={watchSet.has(zone.id)}
      onToggleWatch={user ? () => toggleWatch(zone.id) : null}
      zoneLead={zoneLeads[zone.id]}
      defaultLead={prefs.notifyLead}
      onSetLead={user ? setZoneLead : null}
      showType
      fresh={justResetRef.current.has(zone.id)}
      focus={focusId === zone.id}
      onFocused={() => setFocusId(null)}
      onReset={handleReset}
      onUpdate={handleUpdate}
      onDelete={() => handleDelete(zone.id, zone.name)}
      onClaim={handleClaim}
      onUnclaim={handleUnclaim}
      onClearZone={handleClearZone}
    />
  );

  return (
    <div className="app">
      {/* ---------- LEFT ---------- */}
      <aside className="left">
        <div className="left__clock">
          <span className="hm">
            {clockH}
            <span className="colon">:</span>
            {clockM}
            <em className="ap">{clk.ap}</em>
          </span>
          <button
            className={`bell${alertsOn ? ' is-on' : ''}`}
            aria-label={alertsOn ? 'alerts on' : 'alerts off'}
            onClick={toggleAlerts}
          >
            {alertsOn ? <Bell size={15} /> : <BellOff size={15} />}
            {upNow.length > 0 && <span className="badge">{upNow.length}</span>}
          </button>
        </div>
        <div className="left__secs" aria-hidden="true">
          <i style={{ transform: `scaleX(${clockSecs / 60})` }} />
        </div>
        <div className="left__tz">
          {dualTz ? tzShort(viewerTz) : 'Manila time'}
          {dualTz && <span> · {nowIn(now, MANILA_TZ)} Manila</span>}
        </div>

        <div className="left__id">
          {user ? (
            <button className="left__user" onClick={() => setViewProfile(user.id)}>
              <Avatar name={user.display_name} size={20} /> {user.display_name}
            </button>
          ) : (
            <div className="left__board">{board.name}</div>
          )}
          <span className="left__status">
            {user ? <b>{board.name}</b> : 'browsing'} ·{' '}
            {upNow.length > 0 ? `${upNow.length} up now` : nextUp ? `next in ${formatDuration(nextUp.r)}` : 'all quiet'}
          </span>
          {!user && (
            <button className="left__signin" onClick={() => setBrowsing(false)}>
              sign in
            </button>
          )}
        </div>

        <button
          className="left__log"
          onClick={() => {
            if (gate()) return;
            setQuickLogOpen(true);
          }}
        >
          <Plus size={15} /> Log a reset
        </button>

        <div className="left__gap" />
        <nav className="lnav">
          <button className="lnav__i is-on" title="Overview" aria-label="Overview" onClick={goOverview}>
            <LayoutGrid size={18} />
          </button>
          <button
            className={`lnav__i${watchOnly ? ' is-on' : ''}`}
            title="Watching"
            aria-label="Watching"
            onClick={() => setWatchOnly((v) => !v)}
          >
            <Star size={18} fill={watchOnly ? 'currentColor' : 'none'} />
          </button>
          <button className="lnav__i" title="Recent activity" aria-label="Recent activity" onClick={() => setActivityOpen(true)}>
            <Activity size={18} />
            {activity[0] && now - Date.parse(activity[0].created_at) < 120_000 && <span className="badge" />}
          </button>
          <button className="lnav__i" title="Wallboard" aria-label="Wallboard" onClick={() => setWallboard(true)}>
            <Maximize2 size={18} />
          </button>
          <div className="menu" style={{ position: 'relative' }} ref={menuRef}>
            <button
              className={`lnav__i${menuOpen ? ' is-on' : ''}`}
              title="Menu"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Menu"
              onClick={() => setMenuOpen((v) => !v)}
            >
              <Settings size={18} />
            </button>
            {menuOpen && (
              <>
                <div className="menu__list" role="menu">
                  <div className="menu__head">
                    {user ? `${user.display_name}${isAdmin ? ' · admin' : ''}` : 'not signed in'} ·{' '}
                    {offset === 'same' ? 'Manila time' : `${offset} vs Manila`}
                  </div>
                  {user && (
                    <>
                      <button className="menu__item" onClick={() => { setViewProfile(user.id); setMenuOpen(false); }}>
                        <Avatar name={user.display_name} size={15} /> Your profile
                      </button>
                      <button className="menu__item" onClick={() => { setSettingsOpen(true); setMenuOpen(false); }}>
                        <UserCog size={15} /> Settings
                      </button>
                    </>
                  )}
                  {isAdmin && (
                    <>
                      <button className="menu__item" onClick={() => { setBoardSettingsOpen(true); setMenuOpen(false); }}>
                        <Users size={15} /> Board &amp; members
                      </button>
                      <button className="menu__item" onClick={() => { setAdding(true); setMenuOpen(false); }}>
                        <Plus size={15} /> Add zone
                      </button>
                      <button className="menu__item" onClick={() => { setPasting(true); setMenuOpen(false); }}>
                        <ClipboardPaste size={15} /> Paste Discord log
                      </button>
                      <button className="menu__item" onClick={() => { setManaging(true); setMenuOpen(false); }}>
                        <SlidersHorizontal size={15} /> Edit zones
                      </button>
                    </>
                  )}
                  <button className="menu__item" onClick={() => { load(); setMenuOpen(false); }}>
                    <RefreshCw size={15} /> Refresh now
                  </button>
                  <button className="menu__item menu__item--toggle" onClick={toggleAlerts}>
                    {alertsOn ? <Bell size={15} /> : <BellOff size={15} />}
                    <span>Notifications</span>
                    <span className={`menu__pill${alertsOn ? ' is-on' : ''}`}>{alertsOn ? 'ON' : 'OFF'}</span>
                  </button>
                  {user ? (
                    <button className="menu__item" onClick={handleLogout}>
                      <LogOut size={15} /> Log out
                    </button>
                  ) : (
                    <button className="menu__item" onClick={() => { setBrowsing(false); setMenuOpen(false); }}>
                      <LogOut size={15} style={{ transform: 'scaleX(-1)' }} /> Sign in
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </nav>
        <div className="left__gap left__gap--b" />
      </aside>

      {/* ---------- TOP ---------- */}
      <header className="top">
        <div className="top__view" role="tablist" aria-label="view">
          <button
            role="tab"
            aria-selected={viewMode === 'rooms'}
            className={viewMode === 'rooms' ? 'is-on' : ''}
            onClick={() => setViewMode('rooms')}
          >
            {watchOnly ? 'Watching' : 'Rooms'}
          </button>
          <button
            role="tab"
            aria-selected={viewMode === 'next'}
            className={viewMode === 'next' ? 'is-on' : ''}
            onClick={() => setViewMode('next')}
          >
            Up next
          </button>
        </div>
        <div className="top__r">
          <div className="seg">
            {FILTERS.map(([value, label]) => (
              <button
                key={value}
                className={filter === value ? 'is-on' : ''}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            className="iconbtn"
            aria-label="search"
            onClick={() => {
              setSearchOpen((v) => !v);
              if (searchOpen) setQuery('');
            }}
          >
            <Search size={16} />
          </button>
          <span
            className={`dot dot--${liveStatus}`}
            title={
              error && loadState === 'ready'
                ? `sync failed: ${error}`
                : liveStatus === 'live'
                  ? 'live — updates as your clan logs them'
                  : liveStatus === 'connecting'
                    ? 'reconnecting…'
                    : `polling · synced ${syncedAt ? formatAgo(now - syncedAt) : 'never'}`
            }
          />
        </div>
      </header>

      {searchOpen && (
        <div className="top__search">
          <Search size={15} />
          <input
            autoFocus
            placeholder="filter zones by name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button className="iconbtn" aria-label="clear" onClick={() => setQuery('')} style={{ border: 0 }}>
              <X size={15} />
            </button>
          )}
        </div>
      )}

      {/* ---------- MAIN ---------- */}
      <main className="main">
        {cold && (
          <div className="cold">
            <span>
              Data is cold — nothing logged by the clan in{' '}
              {formatAgo(now - newestReset).replace(' ago', '')}. Times below may be stale.
            </span>
          </div>
        )}
        {newestReset === 0 && loadState === 'ready' && lsGet('oh-tip', '1') === '1' && (
          <div className="onboard">
            <div className="onboard__body">
              <h3>Nothing logged yet</h3>
              <p>
                When someone spots a rift up — or the clan calls a time in Discord — log it here.
                Every zone then counts down to its next window.
              </p>
              <ul>
                <li>
                  <b>Tap a zone</b> to open it, then <b>it came up earlier</b> or <b>it&rsquo;s up now</b>.
                </li>
                <li>
                  Or hit <b>＋ Log a reset</b> (top left) to pick any zone from a list.
                </li>
                <li>
                  <b>Star</b> your key zones — they pin to the top and can alert you.
                </li>
              </ul>
              {user && (
                <button className="btn btn--primary" onClick={() => setQuickLogOpen(true)}>
                  <Plus size={14} /> Log the first reset
                </button>
              )}
            </div>
            <button
              className="iconbtn onboard__x"
              aria-label="dismiss"
              onClick={() => {
                lsSet('oh-tip', '0');
                forceTick((n) => n + 1);
              }}
            >
              <X size={14} />
            </button>
          </div>
        )}

        {loadState === 'loading' && (
          <div className="skel" aria-hidden="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skel__row" />
            ))}
          </div>
        )}
        {loadState === 'error' && (
          <p className="note note--err">
            can&rsquo;t reach the server: {error}{' '}
            <button className="lnk" onClick={() => load()}>
              retry
            </button>
          </p>
        )}

        {loadState === 'ready' && viewMode === 'next' && (
          <section className="room room--next" data-type={filter === 'all' ? 'elite' : filter}>
            <div className="room__head" style={{ cursor: 'default' }}>
              <span className="dot" aria-hidden="true" style={{ background: 'var(--text-dim)' }} />
              <h2>Up next</h2>
              <span className="count">{nextList.live.length} live</span>
            </div>
            {nextList.live.length === 0 ? (
              <p className="room__empty">{q ? 'no match' : 'nothing logged — check "Rooms"'}</p>
            ) : (
              nextList.live.map(renderRow)
            )}
            {nextList.rest.length > 0 && (
              <details className="room__more">
                <summary>{nextList.rest.length} not logged / stale</summary>
                {nextList.rest.map(renderRow)}
              </details>
            )}
          </section>
        )}

        {loadState === 'ready' &&
          viewMode === 'rooms' &&
          groups.map((group) => {
            const isCollapsed = collapsed.has(group.type) && !q;
            return (
              <section className="room" data-type={group.type} key={group.type}>
                <button className="room__head" onClick={() => togglePanel(group.type)}>
                  <ChevronDown size={14} className={`room__chev${isCollapsed ? ' is-collapsed' : ''}`} />
                  <span className="dot" aria-hidden="true" />
                  <h2>{group.meta.label}</h2>
                  <span className="count">
                    {group.zones.length} · {group.meta.short}
                  </span>
                </button>
                {isCollapsed ? null : group.zones.length === 0 ? (
                  <p className="room__empty">
                    {q ? 'no match' : watchOnly ? 'no watched zones here' : 'nothing tracked here yet'}
                  </p>
                ) : (
                  group.zones.map(renderRow)
                )}
              </section>
            );
          })}

        <p className="foot">
          &ldquo;up in / overdue&rdquo; is the last confirmed reset plus the room&rsquo;s cycle. Anyone
          on the server can trigger a reset, so &ldquo;up&rdquo; means <em>should be available — go
          look</em>. Each row&rsquo;s underline fills as the zone cooks and turns green in the last 5
          minutes. {dualTz ? `Times in ${tzShort(viewerTz)} + Manila.` : 'All times Manila.'}
        </p>
      </main>

      {/* ---------- SIDE ---------- */}
      <aside className="side">
        <section className="box">
          <div className="box__head">
            <h2>Up now</h2>
            <span className="m">{upNow.length}</span>
          </div>
          {upNow.length === 0 ? (
            <p className="next__none">nothing up right now.</p>
          ) : (
            upNow.slice(0, 6).map((z) => {
              const r = remainingOf(z, stamp);
              return (
                <button className="rl" key={z.id} onClick={() => jumpTo(z.id)}>
                  <span className="rl__n">
                    <span className={`dot dot--${z.type}`} />
                    <span className="t">{z.name}</span>
                  </span>
                  <span className="rl__t is-up">{r <= 0 ? `overdue ${formatDuration(-r)}` : 'up'}</span>
                </button>
              );
            })
          )}
        </section>

        <section className="box">
          <div className="box__head">
            <h2>Next up</h2>
            <span className="m">{dualTz ? tzShort(viewerTz) : 'Manila'}</span>
          </div>
          {!nextUp ? (
            <p className="next__none">no upcoming resets logged.</p>
          ) : (
            <>
              <button className="next__hero" onClick={() => jumpTo(nextUp.z.id)}>
                <span className="next__big" key={formatDuration(nextUp.r)}>
                  {formatDuration(nextUp.r)}
                </span>
              </button>
              <div className="next__who">
                <span className={`dot dot--${nextUp.z.type}`} /> {shortName(nextUp.z.name)}
                {(() => {
                  const iso = new Date(Date.parse(nextUp.z.last_reset_at) + nextUp.z.interval_minutes * 60000).toISOString();
                  const c = dualClock(iso, viewerTz, now);
                  return ` · ${c.primary.time}`;
                })()}
              </div>
              <div style={{ marginTop: 12 }}>
                {upcoming.slice(1).map(({ z, r }) => (
                  <button className="rl" key={z.id} onClick={() => jumpTo(z.id)}>
                    <span className="rl__n">
                      <span className={`dot dot--${z.type}`} />
                      <span className="t">{z.name}</span>
                    </span>
                    <span className={`rl__t ${remClass(r)}`}>{remLabel(r)}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="box">
          <div className="box__head">
            <h2>Watching</h2>
            <span className="m">{watching.length}</span>
          </div>
          {watching.length === 0 ? (
            <p className="next__none">star a zone to pin it here and get alerts.</p>
          ) : (
            watching.map(({ z, r }) => (
              <button className="rl" key={z.id} onClick={() => jumpTo(z.id)}>
                <span className="rl__n">
                  <span className="star">★</span>
                  <span className={`dot dot--${z.type}`} />
                  <span className="t">{z.name}</span>
                </span>
                <span className={`rl__t ${remClass(r)}`}>{remLabel(r)}</span>
              </button>
            ))
          )}
        </section>

        <section className="box">
          <div className="box__head">
            <h2>Recent activity</h2>
            <span className="m">{liveStatus === 'live' ? 'live' : liveStatus}</span>
          </div>
          {activity.length === 0 ? (
            <p className="next__none">nothing logged yet.</p>
          ) : (
            activity.slice(0, 5).map((it, i) => (
              <div className="ar" key={`${it.created_at}-${i}`}>
                <Avatar name={it.by_name || '?'} size={22} />
                <span className="ar__x">
                  <b>{it.by_name === user?.display_name ? 'You' : it.by_name || 'someone'}</b> logged{' '}
                  <b>{shortName(it.zone)}</b>
                  <em>
                    {(() => {
                      const c = dualClock(it.reset_at, viewerTz, now);
                      return `up ${c.primary.time}`;
                    })()}{' '}
                    · {formatAgo(now - Date.parse(it.created_at))}
                    {it.source === 'discord' ? ' · via Discord' : it.source === 'paste' ? ' · via paste' : ''}
                  </em>
                </span>
              </div>
            ))
          )}
        </section>

        <section className="box">
          <div className="box__head">
            <h2>Board</h2>
            <span className="m">{isAdmin ? 'admin' : board.registration}</span>
          </div>
          <div className="bstat">
            <div>
              <b>{zones.length}</b>
              <span>zones</span>
            </div>
            <div>
              <b>{upNow.length}</b>
              <span>up now</span>
            </div>
            <div>
              <b>{activity.length}</b>
              <span>recent logs</span>
            </div>
          </div>
          {isAdmin ? (
            <button className="btn btn--wide" onClick={() => setBoardSettingsOpen(true)}>
              <Users size={14} /> Board &amp; members
            </button>
          ) : user ? (
            <button className="btn btn--wide btn--primary" onClick={() => setQuickLogOpen(true)}>
              <RotateCcw size={14} /> Log a reset
            </button>
          ) : (
            <button className="btn btn--wide" onClick={() => setBrowsing(false)}>
              Sign in to log resets
            </button>
          )}
        </section>
      </aside>

      {/* ---------- modals ---------- */}
      {adding && <AddZoneModal onClose={() => setAdding(false)} onCreate={handleCreate} />}
      {managing && (
        <RosterModal zones={zones} onClose={() => setManaging(false)} onDone={() => load({ silent: true })} />
      )}
      {pasting && (
        <PasteLogModal zones={zones} onClose={() => setPasting(false)} onDone={() => load({ silent: true })} />
      )}
      {viewProfile != null && (
        <ProfileModal
          userId={viewProfile}
          me={user}
          onClose={() => setViewProfile(null)}
          onMeChange={setUser}
          onLoggedOut={() => {
            setUser(null);
            setBrowsing(true);
            setViewProfile(null);
            toast('Account deleted');
          }}
        />
      )}
      {settingsOpen && user && (
        <SettingsModal me={user} zones={zones} onClose={() => setSettingsOpen(false)} onMeChange={setUser} />
      )}
      {activityOpen && (
        <ActivityModal
          items={activity}
          me={user?.display_name}
          viewerTz={viewerTz}
          now={now}
          isAdmin={isAdmin}
          onJump={jumpTo}
          onClear={clearActivity}
          onClose={() => setActivityOpen(false)}
        />
      )}
      {quickLogOpen && (
        <QuickLogModal
          zones={zones}
          viewerTz={viewerTz}
          now={now}
          onLogNow={async (z) => {
            setQuickLogOpen(false);
            await handleReset(z, {});
          }}
          onLogTime={(z) => {
            setQuickLogOpen(false);
            setQuickLogZone(z);
          }}
          onClose={() => setQuickLogOpen(false)}
        />
      )}
      {quickLogZone && (
        <BackdateModal
          zone={quickLogZone}
          onClose={() => setQuickLogZone(null)}
          onSubmit={async (payload) => {
            await handleReset(quickLogZone, payload);
            setQuickLogZone(null);
          }}
        />
      )}
      {boardSettingsOpen && isAdmin && (
        <BoardSettingsModal
          me={user}
          onClose={() => setBoardSettingsOpen(false)}
          onBoardChange={(b) => setBoard((s) => ({ ...s, ...b }))}
        />
      )}

      <Toaster
        position="bottom-center"
        theme="dark"
        gap={8}
        toastOptions={{
          style: {
            background: '#141518',
            border: '1px solid rgba(255,255,255,0.14)',
            color: '#f0f1f3',
            fontSize: '13px',
          },
        }}
      />
    </div>
  );
}
