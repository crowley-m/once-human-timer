import { useState } from 'react';
import { toast } from 'sonner';
import Modal from './Modal.jsx';
import { api } from '../api.js';
import { LOCAL_TZ } from '../time.js';

const TIME_MODES = [
  ['in', 'up in 12m'],
  ['at', 'up at 06:10'],
  ['both', 'both'],
];
const LEADS = [0, 5, 10, 15];

export default function SettingsModal({ me, zones, onClose, onMeChange }) {
  const p = me.prefs || {};
  const [prefs, setPrefs] = useState({
    timeMode: p.timeMode || 'in',
    density: p.density || 'comfortable',
    notifyLead: p.notifyLead ?? 0,
    hideStale: !!p.hideStale,
    showSource: p.showSource !== false,
    watch: new Set(p.watch || []),
  });
  const [tz, setTz] = useState(me.tz || '');
  const [busy, setBusy] = useState(false);

  const set = (k, v) => setPrefs((s) => ({ ...s, [k]: v }));
  const toggleWatch = (id) =>
    setPrefs((s) => {
      const w = new Set(s.watch);
      w.has(id) ? w.delete(id) : w.add(id);
      return { ...s, watch: w };
    });

  async function save() {
    setBusy(true);
    try {
      const { user } = await api.updateMe({
        tz: tz || null,
        prefs: {
          timeMode: prefs.timeMode,
          density: prefs.density,
          notifyLead: prefs.notifyLead,
          hideStale: prefs.hideStale,
          showSource: prefs.showSource,
          watch: [...prefs.watch],
        },
      });
      onMeChange(user);
      toast.success('Settings saved');
      onClose();
    } catch (e) {
      toast.error(e.message);
      setBusy(false);
    }
  }

  const byType = ['red_card', 'elite', 'blue'].map((t) => ({
    t,
    label: { red_card: 'Red', elite: 'Elite', blue: 'Blue' }[t],
    zones: zones.filter((z) => z.type === t),
  }));

  return (
    <Modal title="Your settings" onClose={onClose} wide>
      <div className="roster">
        <div className="set__row">
          <span>Countdown shows</span>
          <div className="set__opts">
            {TIME_MODES.map(([v, l]) => (
              <button key={v} className={prefs.timeMode === v ? 'is-on' : ''} onClick={() => set('timeMode', v)}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="set__row">
          <span>Row density</span>
          <div className="set__opts">
            {['comfortable', 'compact'].map((v) => (
              <button key={v} className={prefs.density === v ? 'is-on' : ''} onClick={() => set('density', v)}>
                {v}
              </button>
            ))}
          </div>
        </div>
        <div className="set__row">
          <span>Notify me</span>
          <div className="set__opts">
            {LEADS.map((v) => (
              <button key={v} className={prefs.notifyLead === v ? 'is-on' : ''} onClick={() => set('notifyLead', v)}>
                {v === 0 ? 'when up' : `${v}m before`}
              </button>
            ))}
          </div>
        </div>
        <label className="set__row set__row--check">
          <input type="checkbox" checked={prefs.showSource} onChange={(e) => set('showSource', e.target.checked)} />
          <span>Show where a reset came from (discord / pasted line)</span>
        </label>
        <div className="set__row">
          <span>Your timezone</span>
          <select value={tz} onChange={(e) => setTz(e.target.value)}>
            <option value="">auto ({LOCAL_TZ})</option>
            {['Asia/Manila', 'Asia/Colombo', 'Asia/Singapore', 'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'UTC'].map((z) => (
              <option key={z} value={z}>{z}</option>
            ))}
          </select>
        </div>

        <div className="set__watch">
          <p className="form__hint">
            <b>Watch list</b> — starred zones pin to the top and are the only ones that notify you
            (leave empty to watch everything).
          </p>
          {byType.map((g) => (
            <div key={g.t} className="set__watchgroup">
              <span className="set__watchlabel">{g.label}</span>
              {g.zones.map((z) => (
                <button
                  key={z.id}
                  className={`set__wz${prefs.watch.has(z.id) ? ' is-on' : ''}`}
                  onClick={() => toggleWatch(z.id)}
                >
                  {prefs.watch.has(z.id) ? '★' : '☆'} {z.name}
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="form__actions">
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" disabled={busy} onClick={save}>Save settings</button>
        </div>
      </div>
    </Modal>
  );
}
