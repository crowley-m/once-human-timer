import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ArrowLeft, Send } from 'lucide-react';
import { api } from '../api.js';
import { toLocalInputValue } from '../time.js';

const TYPES = [
  ['red_card', 'Red card'],
  ['elite', 'Elite'],
  ['blue', 'Blue'],
];

function Toggle({ on, onChange, label, hint }) {
  return (
    <button type="button" className="opx__toggle" onClick={() => onChange(!on)} aria-pressed={on}>
      <span className={`opx__sw${on ? ' is-on' : ''}`} aria-hidden="true" />
      <span className="opx__toggle-t">
        {label}
        {hint && <em>{hint}</em>}
      </span>
    </button>
  );
}

export default function OpsPage({ zones, onBack }) {
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

  const [pollQ, setPollQ] = useState('');
  const [pollOpts, setPollOpts] = useState(['Yes', 'No']);
  const [polls, setPolls] = useState([]);
  const loadPolls = () => api.polls().then((r) => setPolls(r.polls || [])).catch(() => {});

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
  useEffect(() => {
    loadPolls();
  }, []);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onBack();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);

  async function patch(next) {
    setCfg((c) => ({ ...c, ...next }));
    try {
      setCfg(await api.updateOps(next));
    } catch (e) {
      toast.error(e.message);
      api.ops().then((r) => setCfg(r.config)).catch(() => {});
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

  async function postPoll() {
    const q = pollQ.trim();
    const opts = pollOpts.map((o) => o.trim()).filter(Boolean);
    if (!q || opts.length < 2) return toast.error('need a question and 2+ options');
    setBusy(true);
    try {
      await api.discordPoll(q, opts);
      toast.success('Poll posted');
      setPollQ('');
      setPollOpts(['Yes', 'No']);
      loadPolls();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  const d = data?.discord;
  const canPost = d?.canPost;
  const canButtons = d?.bot && d?.channel;
  const chips = d
    ? [
        ['bot token', d.bot],
        ['channel', d.channel],
        ['webhook', d.webhook],
        ['buttons', d.interactions],
        ['/up', d.slashCommand],
      ]
    : [];

  return (
    <div className="opx">
      <header className="opx__bar">
        <button className="opx__back" onClick={onBack}>
          <ArrowLeft size={15} /> Board
        </button>
        <h1>Bot &amp; ops</h1>
        <div className="opx__chips">
          {chips.map(([label, ok]) => (
            <span key={label} className={`opx__chip${ok ? ' is-ok' : ''}`}>
              {ok ? '●' : '○'} {label}
            </span>
          ))}
          {d && <span className="opx__chip">tz {d.clanTz}</span>}
        </div>
      </header>

      {!cfg ? (
        <p className="opx__loading">loading…</p>
      ) : (
        <div className="opx__grid">
          {/* send a message */}
          <section className="opx__card">
            <h2>Send a message as the bot</h2>
            {!canPost && (
              <p className="opx__warn">No Discord channel configured — set a bot token + channel, or a webhook.</p>
            )}
            <textarea
              className="opx__ta"
              rows={4}
              placeholder="type a message for the clan channel…"
              value={msg}
              maxLength={1800}
              onChange={(e) => setMsg(e.target.value)}
              disabled={!canPost}
            />
            <div className="opx__actions">
              <label className="opx__chk">
                <input
                  type="checkbox"
                  checked={ping}
                  onChange={(e) => setPing(e.target.checked)}
                  disabled={!canPost}
                />
                ping @here
              </label>
              <span className="opx__grow" />
              <button className="btn btn--sm" disabled={busy || !canPost} onClick={postBoard}>
                Post board snapshot
              </button>
              <button
                className="btn btn--sm btn--primary"
                disabled={busy || !canPost || !msg.trim()}
                onClick={send}
              >
                <Send size={13} /> Send
              </button>
            </div>
          </section>

          {/* log a reset */}
          <section className="opx__card">
            <h2>Log a reset</h2>
            <div className="opx__field">
              <span>Zone</span>
              <select value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
                {sortedZones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="opx__field">
              <span>When it was cleared</span>
              <input
                type="datetime-local"
                value={when}
                max={toLocalInputValue(new Date())}
                onChange={(e) => setWhen(e.target.value)}
              />
            </div>
            <div className="opx__actions">
              <span className="opx__grow" />
              <button className="btn btn--sm" disabled={busy} onClick={() => logReset(false)}>
                log at that time
              </button>
              <button className="btn btn--sm btn--primary" disabled={busy} onClick={() => logReset(true)}>
                cleared just now
              </button>
            </div>
            <p className="opx__hint">Next window is a full cycle after the time you set.</p>
          </section>

          {/* reminders */}
          <section className="opx__card">
            <h2>Discord reminders</h2>
            <Toggle
              on={cfg.remindersEnabled}
              onChange={(v) => patch({ remindersEnabled: v })}
              label="Post “heads up” + “up now” reminders"
            />
            <div className="opx__field opx__field--pills">
              <span>Types</span>
              <div>
                {TYPES.map(([val, label]) => {
                  const on = cfg.announceTypes.includes(val);
                  return (
                    <button
                      key={val}
                      type="button"
                      className={`opx__pill${on ? ' is-on' : ''}`}
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
            </div>
            <div className="opx__field">
              <span>Heads-up lead</span>
              <div className="opx__inline">
                <input
                  type="number"
                  min={0}
                  max={120}
                  value={cfg.leadMinutes}
                  onChange={(e) => setCfg((c) => ({ ...c, leadMinutes: e.target.value }))}
                  onBlur={(e) => patch({ leadMinutes: Number(e.target.value) || 0 })}
                />
                <em>min before ( 0 = off )</em>
              </div>
            </div>
            <div className="opx__field">
              <span>Auto-clear timer</span>
              <div className="opx__inline">
                <input
                  type="number"
                  min={0}
                  max={50}
                  value={cfg.expireFactor}
                  onChange={(e) => setCfg((c) => ({ ...c, expireFactor: e.target.value }))}
                  onBlur={(e) => patch({ expireFactor: Number(e.target.value) || 0 })}
                />
                <em>× cycle overdue ( 0 = never )</em>
              </div>
            </div>
            <Toggle
              on={cfg.mirrorActions}
              onChange={(v) => patch({ mirrorActions: v })}
              label="Mirror every website reset to the webhook"
              hint="chatty"
            />
          </section>

          {/* ask the clan */}
          <section className="opx__card">
            <h2>Ask the clan</h2>
            {!canButtons && <p className="opx__warn">Needs a bot token + channel id (voting buttons).</p>}
            <div className="opx__field">
              <span>Question</span>
              <input
                type="text"
                placeholder="e.g. Is the bot working well?"
                value={pollQ}
                maxLength={240}
                onChange={(e) => setPollQ(e.target.value)}
                disabled={!canButtons}
              />
            </div>
            <div className="opx__field">
              <span>Options</span>
              {pollOpts.map((o, i) => (
                <div key={i} className="opx__inline">
                  <input
                    type="text"
                    value={o}
                    maxLength={60}
                    placeholder={`option ${i + 1}`}
                    onChange={(e) => setPollOpts((a) => a.map((x, j) => (j === i ? e.target.value : x)))}
                    disabled={!canButtons}
                    style={{ width: 'auto', flex: '1 1 auto' }}
                  />
                  {pollOpts.length > 2 && (
                    <button
                      className="opx__x"
                      onClick={() => setPollOpts((a) => a.filter((_, j) => j !== i))}
                      aria-label="remove option"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              {pollOpts.length < 5 && (
                <button className="opx__addopt" onClick={() => setPollOpts((a) => [...a, ''])} disabled={!canButtons}>
                  + option
                </button>
              )}
            </div>
            <div className="opx__actions">
              <span className="opx__grow" />
              <button className="btn btn--sm btn--primary" disabled={busy || !canButtons} onClick={postPoll}>
                Post poll
              </button>
            </div>

            {polls.length > 0 && (
              <div className="opx__polls">
                {polls.slice(0, 4).map((p) => (
                  <div key={p.id} className="opx__poll">
                    <b>{p.question}</b>
                    {p.options.map((o, i) => {
                      const pct = p.total ? Math.round((p.counts[i] / p.total) * 100) : 0;
                      const who = p.breakdown?.[i] || [];
                      return (
                        <div key={i} className="opx__prow">
                          <div className="opx__pbar">
                            <span className="opx__pbar-l">{o}</span>
                            <span className="opx__pbar-track">
                              <span className="opx__pbar-fill" style={{ width: `${pct}%` }} />
                            </span>
                            <span className="opx__pbar-n">{p.counts[i]}</span>
                          </div>
                          {who.length > 0 && <div className="opx__pwho">{who.join(', ')}</div>}
                        </div>
                      );
                    })}
                    <em>{p.total} vote{p.total === 1 ? '' : 's'}</em>
                  </div>
                ))}
                <button className="opx__addopt" onClick={loadPolls}>refresh tallies</button>
              </div>
            )}
          </section>

          {/* chat poll */}
          <section className="opx__card">
            <h2>Chat poll</h2>
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
        </div>
      )}
    </div>
  );
}
