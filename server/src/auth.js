import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { db } from './db.js';

const SESSION_DAYS = 45;
const SECURE_COOKIES = /^(1|true)$/i.test(process.env.SECURE_COOKIES || '');
export const COOKIE = 'oh_session';

// ---------------------------------------------------------------------------
// password hashing (scrypt, no deps)
// ---------------------------------------------------------------------------
export function hashPassword(pw) {
  const salt = randomBytes(16);
  const key = scryptSync(pw, salt, 32);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}
export function verifyPassword(pw, stored) {
  const [scheme, saltHex, keyHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;
  const key = scryptSync(pw, Buffer.from(saltHex, 'hex'), 32);
  const expected = Buffer.from(keyHex, 'hex');
  return key.length === expected.length && timingSafeEqual(key, expected);
}

// ---------------------------------------------------------------------------
// users + sessions
// ---------------------------------------------------------------------------
const q = {
  userByName: db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE'),
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  userCount: db.prepare('SELECT COUNT(*) AS n FROM users'),
  adminCount: db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'"),
  insertUser: db.prepare(
    'INSERT INTO users (username, password_hash, role, display_name) VALUES (?, ?, ?, ?)'
  ),
  setPassword: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
  deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
  insertSession: db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)'),
  sessionById: db.prepare('SELECT * FROM sessions WHERE id = ?'),
  deleteSession: db.prepare('DELETE FROM sessions WHERE id = ?'),
  purgeSessions: db.prepare("DELETE FROM sessions WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%fZ','now')"),
  board: db.prepare('SELECT * FROM board WHERE id = 1'),
};

const USERNAME_RE = /^[A-Za-z0-9 _.\-]{2,24}$/;

export const getBoard = () => q.board.get();
export const userById = (id) => q.userById.get(id);

export function createUser(username, password, inviteCode) {
  username = String(username || '').trim();
  if (!USERNAME_RE.test(username)) {
    throw Object.assign(new Error('username must be 2-24 chars: letters, numbers, space, _ . -'), { status: 400 });
  }
  if (String(password || '').length < 6) {
    throw Object.assign(new Error('password must be at least 6 characters'), { status: 400 });
  }
  const board = q.board.get();
  const first = q.userCount.get().n === 0;
  if (!first && board.registration === 'invite') {
    if (!board.invite_code || String(inviteCode || '').trim() !== board.invite_code) {
      throw Object.assign(new Error('a valid invite code is required to join this board'), { status: 403 });
    }
  }
  if (q.userByName.get(username)) {
    throw Object.assign(new Error('that username is taken'), { status: 409 });
  }
  const info = q.insertUser.run(username, hashPassword(password), first ? 'admin' : 'member', username);
  return q.userById.get(info.lastInsertRowid);
}

export function changePassword(userId, currentPw, newPw) {
  const u = q.userById.get(userId);
  if (!u || !verifyPassword(currentPw, u.password_hash)) {
    throw Object.assign(new Error('current password is wrong'), { status: 401 });
  }
  if (String(newPw || '').length < 6) {
    throw Object.assign(new Error('new password must be at least 6 characters'), { status: 400 });
  }
  q.setPassword.run(hashPassword(newPw), userId);
}

export function deleteAccount(userId, currentPw) {
  const u = q.userById.get(userId);
  if (!u || !verifyPassword(currentPw, u.password_hash)) {
    throw Object.assign(new Error('password is wrong'), { status: 401 });
  }
  if (u.role === 'admin' && q.adminCount.get().n <= 1) {
    throw Object.assign(new Error('you are the only admin — promote someone else first'), { status: 409 });
  }
  q.deleteUser.run(userId);
}

export function login(username, password) {
  const user = q.userByName.get(String(username || '').trim());
  if (!user || !verifyPassword(password, user.password_hash)) {
    throw Object.assign(new Error('wrong username or password'), { status: 401 });
  }
  return user;
}

export function startSession(userId) {
  q.purgeSessions.run();
  const id = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  q.insertSession.run(id, userId, expires);
  return { id, expires };
}
export function endSession(id) {
  if (id) q.deleteSession.run(id);
}
export function sessionUser(id) {
  if (!id) return null;
  const s = q.sessionById.get(id);
  if (!s || new Date(s.expires_at) < new Date()) {
    if (s) q.deleteSession.run(id);
    return null;
  }
  return q.userById.get(s.user_id);
}

export function meShape(u) {
  if (!u) return null;
  let prefs = {};
  try {
    prefs = u.prefs ? JSON.parse(u.prefs) : {};
  } catch {
    /* bad json */
  }
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    display_name: u.display_name || u.username,
    role_tag: u.role_tag || null,
    tz: u.tz || null,
    prefs,
    created_at: u.created_at,
  };
}
export const publicUser = meShape; // alias kept for existing call sites

export function setSessionCookie(res, id, expires) {
  res.cookie(COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: SECURE_COOKIES,
    expires: new Date(expires),
    path: '/',
  });
}
export function clearSessionCookie(res) {
  res.clearCookie(COOKIE, { path: '/' });
}

// ---------------------------------------------------------------------------
// middleware
// ---------------------------------------------------------------------------
export function attachUser(req, _res, next) {
  req.user = sessionUser(req.cookies?.[COOKIE]);
  next();
}
export function requireAuth(req, res, next) {
  if (req.apiKeyOk || req.user) return next();
  return res.status(401).json({ error: 'sign in to do that' });
}
export function requireAdmin(req, res, next) {
  if (req.apiKeyOk || req.user?.role === 'admin') return next();
  return res.status(403).json({ error: 'only a board admin can change the roster' });
}
