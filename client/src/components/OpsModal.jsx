import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Send, Megaphone, Power } from 'lucide-react';
import Modal from './Modal.jsx';
import { api } from '../api.js';
import { toLocalInputValue } from '../time.js';

const TYPES = [
  ['red_card', 'Red card'],
  ['elite', 'Elite'],
  ['blue', 'Blue'],
];

function Toggle({ on, onChange, label, hint }) {
  return (
    <button type="button" className="ops__toggle" onClick={() => onChange(!on)}>
      <span className={`ops__sw${on ? ' is-on' : ''}`} aria-hidden="true" />
      <span className="ops__toggle-t">
        {label}
        {hint && <em>{hint}</em>}
      </span>
    </button>
  );
}

export default function OpsModal({ zones, onClose }) {
  const [data, setData] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [busy, setBusy] = useState(false);

  const [msg, setMsg] = useState('');
  const [ping, setPing] = useState(false);

  const sortedZones = useMemo(
    () => [...(zones || [])].sort((a, b) => a.name.localeCompare(b.name)),
    [zones]
  );
  const [zoneId, setZoneId] = useState('');
  const [when, setWhen] = useState(toLocalInputValue(new Date()));

  useEffect(() => {
    api
      .ops()
      .then((r) => {
        setData(r);
        setCfg(r.config);
      })
      .catch((e) => toast.error(e.message));
  }, []);
  useEffect(() => {
    if (sortedZones.length && !zoneId) setZoneId(String(sortedZones[0].id));
  }, [sortedZones, zoneId]);

  async function patch(next) {
    setCfg((c) => ({ ...c, ...next }));
    try {
      const saved = await api.updateOps(next);
      setCfg(saved);
    } catch (e) {
      toast.error(e.message);
      api.ops().then((r) => setCfg(r.config));
    }
  }

  async function send() {
    if (!msg.trim()) return;
    setBusy(true);
    try {
      await api.discordSay(msg.trim(), ping);
      toast.success('Sent to Discord');
      setMsg('');
      setPing(false);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function postBoard() {
    setBusy(true);
    try {
      await api.discordPostBoard();
      toast.success('Board snapshot posted');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function logReset(nowInstead) {
    const zone = sortedZones.find((z) => String(z.id) === String(zoneId));
    if (!zone) return;
    const d = nowInstead ? new Date() : new Date(when);
    if (Number.isNaN(d.getTime())) return toast.error('pick a valid time');
    if (d.getTime() > Date.now() + 60_000) return toast.error('that time is in the future');
    setBusy(true);
    try {
      await api.resetZone(zone.id, { reset_at: d.toISOString(), note: 'via ops panel' });
      toast.success(`${zone.name} — logged`);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  const d = data?.discord;
  const canPost = d?.canPost;

  return (
    <Modal title="Bot & ops" onClose={onClose}>
      <div className="ops">
        {!cfg ? (
          <p className="form__hint">loading…</p>
        ) : (
          <>
            {/* ---- send a message ---- */}
            <section className="ops__sec">
              <h3><Megaphone size={13} /> Send a message as the bot</h3>
              {!canPost && <p className="ops__warn">No Discord channel configured — set a bot token + channel or a webhook.</p>}
              <textarea
                className="ops__ta"
                rows={3}
                placeholder="type a message for the clan channel…"
                value={msg}
                maxLength={1800}
                onChange={(e) => setMsg(e.target.value)}
                disabled={!canPost}
              />
              <div className="ops__row">
                <label className="ops__chk">
                  <input type="checkbox" checked={ping} onChange={(e) => setPing(e.target.checked)} disabled={!canPost} />
                  ping @here
                </label>
                <div className="ops__spacer" />
                <button className="btn btn--sm" disabled={busy || !canPost} onClick={postBoard}>
                  Post board snapshot
                </button>
                <button className="btn btn--sm btn--primary" disabled={busy || !canPost || !msg.trim()} onClick={send}>
                  <Send size={13} /> Send
                </button>
              </div>
            </section>

            {/* ---- add a time ---- */}
            <section className="ops__sec">
              <h3>Log a reset</h3>
              <div className="ops__row">
                <select value={zoneId} onChange={(e) => setZoneId(e.target.value)} className="ops__sel">
                  {sortedZones.map((z) => (
                    <option key={z.id} value={z.id}>{z.name}</option>
                  ))}
                </select>
                <input
                  type="datetime-local"
                  value={when}
                  max={toLocalInputValue(new Date())}
                  onChange={(e) => setWhen(e.target.value)}
                  className="ops__dt"
                />
              </div>
              <div className="ops__row">
                <div className="ops__spacer" />
                <button className="btn btn--sm" disabled={busy} onClick={() => logReset(false)}>log at that time</button>
                <button className="btn btn--sm btn--primary" disabled={busy} onClick={() => logReset(true)}>cleared just now</button>
              </div>
              <p className="form__hint">The time is when the zone was cleared — next window is a full cycle after it.</p>
            </section>

            {/* ---- reminders ---- */}
            <section className="ops__sec">
              <h3>Discord reminders</h3>
              <Toggle
                on={cfg.remindersEnabled}
                onChange={(v) => patch({ remindersEnabled: v })}
                label="Post “heads up” + “up now” reminders"
              />
              <div className="ops__row ops__types">
                <span>for</span>
                {TYPES.map(([val, label]) => {
                  const on = cfg.announceTypes.includes(val);
                  return (
                    <button
                      key={val}
                      type="button"
                      className={`ops__pill${on ? ' is-on' : ''}`}
                      onClick={() =>
                        patch({
                          announceTypes: on
                            ? cfg.announceTypes.filter((t) => t !== val)
                            : [...cfg.announceTypes, val],
                        })
                      }
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <label className="ops__num">
                Heads-up lead
                <input
                  type="number"
                  min={0}
                  max={120}
                  value={cfg.leadMinutes}
                  onChange={(e) => setCfg((c) => ({ ...c, leadMinutes: e.target.value }))}
                  onBlur={(e) => patch({ leadMinutes: Number(e.target.value) || 0 })}
                />
                min before ( 0 = off )
              </label>
              <label className="ops__num">
                Auto-clear a timer after
                <input
                  type="number"
                  min={0}
                  max={50}
                  value={cfg.expireFactor}
                  onChange={(e) => setCfg((c) => ({ ...c, expireFactor: e.target.value }))}
                  onBlur={(e) => patch({ expireFactor: Number(e.target.value) || 0 })}
                />
                × its cycle overdue ( 0 = never )
              </label>
              <Toggle
                on={cfg.mirrorActions}
                onChange={(v) => patch({ mirrorActions: v })}
                label="Mirror every website reset to the webhook"
                hint="chatty"
              />
            </section>

            {/* ---- chat poll ---- */}
            <section className="ops__sec">
              <h3><Power size={13} /> Chat poll</h3>
              <Toggle
                on={cfg.pollEnabled}
                onChange={(v) => patch({ pollEnabled: v })}
                label="Read the clan channel for times"
                hint="applies on the next run (~5 min)"
              />
              <Toggle
                on={cfg.confirmLogs}
                onChange={(v) => patch({ confirmLogs: v })}
                label="Reply “✅ logged from chat” after logging"
              />
            </section>

            {d && (
              <p className="ops__status">
                bot {d.bot ? '✓' : '✗'} · channel {d.channel ? '✓' : '✗'} · webhook {d.webhook ? '✓' : '✗'} ·
                buttons {d.interactions ? '✓' : '✗'} · /up {d.slashCommand ? '✓' : '✗'} · tz {d.clanTz}
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
