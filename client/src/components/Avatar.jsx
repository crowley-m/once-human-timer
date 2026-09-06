// Deterministic initials avatar — no upload infra, no external service.
const HUES = [8, 32, 145, 190, 220, 265, 320];

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function initials(name) {
  const parts = String(name || '?').trim().split(/[\s_.-]+/).filter(Boolean);
  return ((parts[0]?.[0] || '?') + (parts[1]?.[0] || '')).toUpperCase();
}

export default function Avatar({ name, size = 32 }) {
  const h = HUES[hash(name || '') % HUES.length];
  return (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
        background: `hsl(${h} 45% 22%)`,
        color: `hsl(${h} 70% 78%)`,
        border: `1px solid hsl(${h} 45% 34%)`,
      }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
