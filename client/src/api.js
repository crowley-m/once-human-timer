const BASE = '/api';

async function request(path, options) {
  const res = await fetch(BASE + path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* no JSON body */
    }
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  // auth + profile
  me: () => request('/auth/me'),
  register: (username, password, invite) =>
    request('/auth/register', { method: 'POST', body: JSON.stringify({ username, password, invite }) }),
  login: (username, password) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  updateMe: (patch) => request('/me', { method: 'PATCH', body: JSON.stringify(patch) }),
  changePassword: (current, next) =>
    request('/me/password', { method: 'POST', body: JSON.stringify({ current, next }) }),
  deleteMe: (password) => request('/me', { method: 'DELETE', body: JSON.stringify({ password }) }),
  userProfile: (id) => request(`/users/${id}`),
  activity: () => request('/activity'),
  contributors: (days = 7) => request(`/stats/contributors?days=${days}`),
  clearActivity: (alsoTimers) =>
    request(`/activity${alsoTimers ? '?timers=1' : ''}`, { method: 'DELETE' }),

  // ops panel (admin)
  ops: () => request('/admin/ops'),
  updateOps: (patch) => request('/admin/ops', { method: 'PATCH', body: JSON.stringify(patch) }),
  discordSay: (content, ping) =>
    request('/admin/discord/say', { method: 'POST', body: JSON.stringify({ content, ping: !!ping }) }),
  discordPostBoard: () => request('/admin/discord/post-board', { method: 'POST' }),
  polls: () => request('/admin/polls'),
  discordPoll: (question, options) =>
    request('/admin/discord/poll', { method: 'POST', body: JSON.stringify({ question, options }) }),

  // board
  boardFull: () => request('/board/full'),
  updateBoard: (patch) => request('/board', { method: 'PATCH', body: JSON.stringify(patch) }),
  setMemberRole: (id, role) =>
    request(`/board/members/${id}`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  removeMember: (id) => request(`/board/members/${id}`, { method: 'DELETE' }),

  // zones
  listZones: () => request('/zones'),
  createZone: (data) => request('/zones', { method: 'POST', body: JSON.stringify(data) }),
  resetZone: (id, data) =>
    request(`/zones/${id}/reset`, { method: 'POST', body: JSON.stringify(data ?? {}) }),
  updateZone: (id, data) =>
    request(`/zones/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteZone: (id) => request(`/zones/${id}`, { method: 'DELETE' }),
  claimZone: (id) => request(`/zones/${id}/claim`, { method: 'POST', body: '{}' }),
  unclaimZone: (id) => request(`/zones/${id}/unclaim`, { method: 'POST' }),
  clearZone: (id) => request(`/zones/${id}/clear`, { method: 'POST' }),
  zoneHistory: (id) => request(`/zones/${id}/history`),

  // push notifications
  pushVapid: () => request('/push/vapid'),
  pushSubscribe: (sub) => request('/push/subscribe', { method: 'POST', body: JSON.stringify({ sub }) }),
  pushUnsubscribe: (endpoint) =>
    request('/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint }) }),
};
