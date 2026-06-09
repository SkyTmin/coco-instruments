import { useMemo, useState } from 'react';
import { Sheet } from '@/components/ui';
import type { Note } from '@/types';
import { normalizeNoteTitle } from '@/lib/notes-graph';

/** A searchable list of notes to link to — shared by the composer and the
 *  connections hub so "связать заметку" works the same everywhere. */
export function NotePicker({
  notes,
  title = 'Связать с заметкой',
  excludeId,
  onPick,
  onClose,
}: {
  notes: Note[];
  title?: string;
  excludeId?: string;
  onPick: (note: Note) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const results = useMemo(() => {
    const key = normalizeNoteTitle(q);
    return notes
      .filter((n) => n.id !== excludeId && n.title && (!key || normalizeNoteTitle(n.title).includes(key)))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 30);
  }, [notes, q, excludeId]);

  return (
    <Sheet title={title} onClose={onClose}>
      <input
        className="input"
        autoFocus
        placeholder="Найти заметку…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="link-picker">
        {results.map((n) => (
          <button key={n.id} className="flow-row" onClick={() => onPick(n)}>
            <span className="flow-row__name">{n.title}</span>
            <span className="link-picker__hint">связать</span>
          </button>
        ))}
        {!results.length && <div className="muted link-picker__empty">Заметок не найдено</div>}
      </div>
    </Sheet>
  );
}
