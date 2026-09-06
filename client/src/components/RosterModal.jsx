import { useMemo, useState } from 'react';
import Modal from './Modal.jsx';
import { api } from '../api.js';

const DEFAULT_INTERVAL = { red_card: 120, elite: 60, blue: 60 };
const SHORT = { red_card: 'red', elite: 'elite', blue: 'blue' };

const TYPE_ALIASES = {
  red: 'red_card',
  'red card': 'red_card',
  'red card room': 'red_card',
  redcard: 'red_card',
  card: 'red_card',
  elite: 'elite',
  boss: 'elite',
  blue: 'blue',
  'blue room': 'blue',
  loot: 'blue',
};

const normType = (s) =>
  TYPE_ALIASES[
    String(s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  ] || null;

/** Turn the current zone list into editable text. */
export function rosterToText(zones) {
  const rank = { red_card: 0, elite: 1, blue: 2 };
  return [...zones]
    .sort((a, b) => (rank[a.type] - rank[b.type]) || a.name.localeCompare(b.name))
    .map((z) => {
      let tail = '';
      if (z.type === 'blue' && z.interval_minutes == null) tail = ' | none';
      else if (z.interval_minutes && z.interval_minutes !== DEFAULT_INTERVAL[z.type])
        tail = ` | ${z.interval_minutes}`;
      return `${z.name} | ${SHORT[z.type]}${tail}`;
    })
    .join('\n');
}

function parse(text) {
  const rows = [];
  const errors = [];
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith('#')) return;
    const [name, rawType, rawInt] = line.split('|').map((s) => (s ?? '').trim());
    if (!name) return;
    const type = normType(rawType);
    if (!type) {
      errors.push(`line ${i + 1}: "${line}" — add a type after "|"  (red / elite / blue)`);
      return;
    }
    let interval_minutes = DEFAULT_INTERVAL[type];
    if (rawInt) {
      if (/^(none|-)$/i.test(rawInt)) {
        interval_minutes = type === 'blue' ? null : DEFAULT_INTERVAL[type];
      } else {
        const n = parseInt(rawInt, 10);
        if (Number.isFinite(n) && n > 0) interval_minutes = n;
        else errors.push(`line ${i + 1}: "${rawInt}" is not a valid interval`);
      }
    }
    rows.push({ name, type, interval_minutes });
  });
  const seen = new Set();
  for (const r of rows) {
    const k = r.name.toLowerCase();
    if (seen.has(k)) errors.push(`duplicate name: "${r.name}"`);
    seen.add(k);
  }
  return { rows, errors };
}

export default function RosterModal({ zones, onClose, onDone }) {
  const [text, setText] = useState(() => rosterToText(zones));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const plan = useMemo(() => {
    const { rows, errors } = parse(text);
    const byName = new Map(zones.map((z) => [z.name, z]));
    const want = new Set(rows.map((r) => r.name));
    const create = rows.filter((r) => !byName.has(r.name));
    const update = rows.filter((r) => {
      const z = byName.get(r.name);
      return (
        z &&
        (z.type !== r.type ||
          (z.interval_minutes ?? null) !== (r.interval_minutes ?? null))
      );
    });
    const remove = zones.filter((z) => !want.has(z.name));
    return { rows, errors, create, update, remove };
  }, [text, zones]);

  const removeWithData = plan.remove.filter((z) => z.last_reset_at).length;
  const nothingToDo =
    plan.create.length === 0 && plan.update.length === 0 && plan.remove.length === 0;

  async function apply() {
    setBusy(true);
    setErr(null);
    try {
      for (const z of plan.remove) await api.deleteZone(z.id);
      for (const r of plan.update) {
        const z = zones.find((x) => x.name === r.name);
        await api.updateZone(z.id, {
          name: r.name,
          type: r.type,
          interval_minutes: r.interval_minutes,
        });
      }
      for (const r of plan.create) await api.createZone(r);
      await onDone();
      onClose();
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Edit zone roster" onClose={onClose} wide>
      <div className="roster">
        <p className="form__hint">
          One zone per line: <code>Full name | type</code> — type is <code>red</code>,{' '}
          <code>elite</code>, or <code>blue</code>. Optional third field sets the reset interval in
          minutes (defaults: red 120, elite 60, blue 60; write <code>none</code> for a blue room
          with no interval). Lines starting with <code>//</code> are ignored. Matching is by exact
          name — renaming a zone here drops its logged reset, so use the row’s <code>edit</code>{' '}
          button for pure renames.
        </p>

        <textarea
          className="roster__text"
          spellCheck={false}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={16}
        />

        {plan.errors.length > 0 ? (
          <ul className="roster__errs">
            {plan.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        ) : (
          <div className="roster__plan">
            {nothingToDo ? (
              <span className="c-dim">no changes</span>
            ) : (
              <>
                {plan.create.length > 0 && (
                  <p>
                    <span className="roster__tag roster__tag--add">+{plan.create.length} new</span>{' '}
                    {plan.create.map((r) => r.name).join(', ')}
                  </p>
                )}
                {plan.update.length > 0 && (
                  <p>
                    <span className="roster__tag">~{plan.update.length} changed</span>{' '}
                    {plan.update.map((r) => r.name).join(', ')}
                  </p>
                )}
                {plan.remove.length > 0 && (
                  <p>
                    <span className="roster__tag roster__tag--del">
                      −{plan.remove.length} removed
                    </span>{' '}
                    {plan.remove.map((r) => r.name).join(', ')}
                    {removeWithData > 0 && (
                      <span className="roster__warn">
                        {' '}
                        — {removeWithData} of these had a logged reset that will be lost
                      </span>
                    )}
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {err && <p className="form__err">{err}</p>}

        <div className="form__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy || plan.errors.length > 0 || nothingToDo}
            onClick={apply}
          >
            {busy ? 'Syncing…' : 'Sync roster'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
