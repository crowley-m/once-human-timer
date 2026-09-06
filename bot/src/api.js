const BASE = (process.env.API_URL || 'http://localhost:3001/api').replace(/\/$/, '');
const KEY = process.env.API_SECRET || null;

const headers = () => ({
  'Content-Type': 'application/json',
  ...(KEY ? { 'x-api-key': KEY } : {}),
});

export async function loadRoster() {
  const r = await fetch(`${BASE}/zones`);
  if (!r.ok) throw new Error(`GET /zones -> ${r.status}`);
  return r.json();
}

export async function getLearned() {
  try {
    const r = await fetch(`${BASE}/learned`);
    return r.ok ? await r.json() : {};
  } catch {
    return {};
  }
}

export async function reportUnclear({ line, candidates, up_at, phrase }) {
  const r = await fetch(`${BASE}/discord/unclear`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ line, candidates, up_at, phrase }),
  });
  if (!r.ok) throw new Error(`POST unclear -> ${r.status} ${await r.text()}`);
  return r.json();
}

export async function logReset(zoneId, resetAtIso, by, note) {
  const r = await fetch(`${BASE}/zones/${zoneId}/reset`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      reset_at: resetAtIso,
      by: (by || 'discord').slice(0, 60),
      ...(note ? { note: String(note).slice(0, 200) } : {}),
    }),
  });
  if (!r.ok) throw new Error(`POST reset -> ${r.status} ${await r.text()}`);
  return r.json();
}
