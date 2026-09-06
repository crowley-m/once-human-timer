import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import Modal from './Modal.jsx';
import Avatar from './Avatar.jsx';
import { api } from '../api.js';

export default function BoardSettingsModal({ me, onClose, onBoardChange }) {
  const [board, setBoard] = useState(null);
  const [name, setName] = useState('');
  const [reg, setReg] = useState('open');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.boardFull().then((b) => {
      setBoard(b);
      setName(b.name);
      setReg(b.registration);
      setCode(b.invite_code || '');
    }).catch((e) => toast.error(e.message));
  }, []);

  async function save() {
    setBusy(true);
    try {
      const b = await api.updateBoard({ name: name.trim(), registration: reg, invite_code: code.trim() || null });
      setBoard((s) => ({ ...s, ...b }));
      onBoardChange({ name: b.name, registration: b.registration });
      toast.success('Board saved');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function setRole(u, role) {
    try {
      await api.setMemberRole(u.id, role);
      setBoard((s) => ({ ...s, members: s.members.map((m) => (m.id === u.id ? { ...m, role } : m)) }));
    } catch (e) {
      toast.error(e.message);
    }
  }
  async function remove(u) {
    if (!confirm(`Remove ${u.display_name || u.username} from the board?`)) return;
    try {
      await api.removeMember(u.id);
      setBoard((s) => ({ ...s, members: s.members.filter((m) => m.id !== u.id) }));
    } catch (e) {
      toast.error(e.message);
    }
  }

  return (
    <Modal title="Board settings" onClose={onClose}>
      <div className="form">
        <label className="field">
          <span>Board name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={50} />
        </label>
        <div className="set__row">
          <span>Who can join</span>
          <div className="set__opts">
            <button className={reg === 'open' ? 'is-on' : ''} onClick={() => setReg('open')}>anyone</button>
            <button className={reg === 'invite' ? 'is-on' : ''} onClick={() => setReg('invite')}>invite code</button>
          </div>
        </div>
        {reg === 'invite' && (
          <label className="field">
            <span>Invite code</span>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="give this to your clan" maxLength={40} />
          </label>
        )}
        <div className="form__actions">
          <button className="btn btn--primary" disabled={busy} onClick={save}>Save</button>
        </div>

        <div className="prof__section">
          <h3>Members ({board?.members.length ?? '…'})</h3>
          <ul className="members">
            {board?.members.map((u) => (
              <li key={u.id}>
                <Avatar name={u.display_name || u.username} size={26} />
                <span className="members__name">{u.display_name || u.username}</span>
                <select value={u.role} onChange={(e) => setRole(u, e.target.value)} disabled={u.id === me.id}>
                  <option value="member">member</option>
                  <option value="admin">admin</option>
                </select>
                {u.id !== me.id && (
                  <button className="iconbtn" aria-label="remove" onClick={() => remove(u)}>
                    <Trash2 size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Modal>
  );
}
