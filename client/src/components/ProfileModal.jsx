import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import Modal from './Modal.jsx';
import Avatar from './Avatar.jsx';
import { api } from '../api.js';
import { MANILA_TZ, clockIn } from '../time.js';

export default function ProfileModal({ userId, me, onClose, onMeChange, onLoggedOut }) {
  const self = me && me.id === userId;
  const [profile, setProfile] = useState(null);
  const [err, setErr] = useState(null);

  // self-edit state
  const [displayName, setDisplayName] = useState(me?.display_name || '');
  const [roleTag, setRoleTag] = useState(me?.role_tag || '');
  const [savingP, setSavingP] = useState(false);
  const [pwOld, setPwOld] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [danger, setDanger] = useState(false);
  const [delPw, setDelPw] = useState('');

  useEffect(() => {
    api.userProfile(userId).then(setProfile).catch((e) => setErr(e.message));
  }, [userId]);

  async function saveProfile(e) {
    e.preventDefault();
    setSavingP(true);
    try {
      const { user } = await api.updateMe({ display_name: displayName.trim(), role_tag: roleTag.trim() });
      onMeChange(user);
      toast.success('Profile saved');
    } catch (e2) {
      toast.error(e2.message);
    } finally {
      setSavingP(false);
    }
  }
  async function changePw(e) {
    e.preventDefault();
    setPwBusy(true);
    try {
      await api.changePassword(pwOld, pwNew);
      setPwOld('');
      setPwNew('');
      toast.success('Password changed');
    } catch (e2) {
      toast.error(e2.message);
    } finally {
      setPwBusy(false);
    }
  }
  async function del() {
    try {
      await api.deleteMe(delPw);
      onLoggedOut();
    } catch (e2) {
      toast.error(e2.message);
    }
  }

  const name = profile?.display_name || me?.display_name || '';

  return (
    <Modal title={self ? 'Your profile' : 'Profile'} onClose={onClose}>
      <div className="prof">
        <div className="prof__head">
          <Avatar name={name} size={52} />
          <div>
            <div className="prof__name">{name}</div>
            <div className="prof__sub">
              {profile?.role === 'admin' && <span className="prof__badge">admin</span>}
              {profile?.role_tag && <span>{profile.role_tag}</span>}
            </div>
          </div>
        </div>

        {err && <p className="form__err">{err}</p>}

        {profile && (
          <>
            <div className="prof__stats">
              <div><b>{profile.stats.resets}</b><span>resets logged</span></div>
              <div><b>{profile.stats.claims_active}</b><span>zones claimed</span></div>
              <div>
                <b>{new Date(profile.created_at).toLocaleDateString('en', { month: 'short', year: 'numeric' })}</b>
                <span>joined</span>
              </div>
            </div>

            <div className="prof__section">
              <h3>Recent resets</h3>
              {profile.recent.length === 0 ? (
                <p className="form__hint">none yet</p>
              ) : (
                <ul className="prof__recent">
                  {profile.recent.map((r, i) => (
                    <li key={i}>
                      <span>{r.zone}</span>
                      <span className="c-dim">
                        {clockIn(r.reset_at, MANILA_TZ, Date.now()).time} MNL · {r.source}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        {self && (
          <>
            <form className="prof__section form" onSubmit={saveProfile}>
              <h3>Edit</h3>
              <label className="field">
                <span>Display name</span>
                <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} minLength={2} maxLength={40} />
              </label>
              <label className="field">
                <span>Clan role (optional)</span>
                <input value={roleTag} onChange={(e) => setRoleTag(e.target.value)} maxLength={30} placeholder="raid lead, scout…" />
              </label>
              <button className="btn btn--primary btn--sm" disabled={savingP}>Save profile</button>
            </form>

            <form className="prof__section form" onSubmit={changePw}>
              <h3>Change password</h3>
              <label className="field">
                <span>Current password</span>
                <input type="password" value={pwOld} onChange={(e) => setPwOld(e.target.value)} autoComplete="current-password" />
              </label>
              <label className="field">
                <span>New password</span>
                <input type="password" value={pwNew} onChange={(e) => setPwNew(e.target.value)} minLength={6} autoComplete="new-password" />
              </label>
              <button className="btn btn--sm" disabled={pwBusy || !pwOld || pwNew.length < 6}>Update password</button>
            </form>

            <div className="prof__section form__danger">
              {danger ? (
                <>
                  <input
                    type="password"
                    placeholder="password to confirm"
                    value={delPw}
                    onChange={(e) => setDelPw(e.target.value)}
                  />
                  <button className="btn btn--sm btn--danger" disabled={!delPw} onClick={del}>Delete my account</button>
                  <button className="btn btn--sm btn--ghost" onClick={() => setDanger(false)}>cancel</button>
                </>
              ) : (
                <button className="btn btn--sm btn--ghost" onClick={() => setDanger(true)}>Delete account…</button>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
