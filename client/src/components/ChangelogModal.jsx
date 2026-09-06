import Modal from './Modal.jsx';
import { CHANGELOG } from '../changelog.js';

export default function ChangelogModal({ onClose }) {
  return (
    <Modal title="What's new" onClose={onClose}>
      <div className="chlog">
        {CHANGELOG.map((entry, i) => (
          <section className="chlog__e" key={`${entry.date}-${i}`}>
            <div className="chlog__h">
              <h3>{entry.title}</h3>
              <time>{entry.date}</time>
            </div>
            <ul>
              {entry.items.map((it, j) => (
                <li key={j}>{it}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}
