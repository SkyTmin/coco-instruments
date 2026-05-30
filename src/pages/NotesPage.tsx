import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState, Screen, StatTile } from '@/components/ui';
import { IconGraph, IconNotes, IconPlus } from '@/components/icons';
import type { Note } from '@/types';
import { useFinanceStore } from '@/store';
import { buildNoteGraph, normalizeNoteTitle, parseNoteTags } from '@/lib/notes-graph';
import { selectionChanged, tapLight } from '@/lib/haptics';

export const noteDateFmt = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export function noteSnippet(note: Note): string {
  const clean = note.body
    .replace(/\[\[([^[\]|#]+)(?:#[^[\]|]+)?(?:\|([^[\]]+))?\]\]/g, '$2$1')
    .replace(/(^|[^#\p{L}\p{N}_-])#[\p{L}\p{N}_][\p{L}\p{N}_-]{0,31}/gu, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean) return clean;
  if (note.attachments?.length) return `Вложений: ${note.attachments.length}`;
  return 'Пустая заметка';
}

export function NotesPage() {
  const navigate = useNavigate();
  const notes = useFinanceStore((s) => s.notes);
  const [query, setQuery] = useState('');

  const graph = useMemo(() => buildNoteGraph(notes), [notes]);
  const queryKey = normalizeNoteTitle(query);
  const filteredNotes = useMemo(() => {
    const list = [...notes].sort((a, b) => b.updatedAt - a.updatedAt);
    if (!queryKey) return list;
    return list.filter((note) => normalizeNoteTitle(`${note.title} ${note.body}`).includes(queryKey));
  }, [notes, queryKey]);

  const go = (path: string) => {
    tapLight();
    navigate(path);
  };

  return (
    <Screen
      title="Заметки"
      subtitle="Быстрые записи и связи"
      action={
        <button className="btn btn--primary notes-head-action" onClick={() => go('/notes/new')}>
          <IconPlus size={18} />
          Создать
        </button>
      }
    >
      <div className="stack notes-page">
        <div className="notes-actions">
          <button className="notes-action notes-action--primary" onClick={() => go('/notes/new')}>
            <IconNotes />
            <span>Новая заметка</span>
          </button>
          <button className="notes-action" onClick={() => go('/notes/graph')}>
            <IconGraph />
            <span>Граф</span>
          </button>
        </div>

        <div className="card">
          <div className="stat-grid">
            <StatTile label="Заметок" value={notes.length} />
            <StatTile label="Связей" value={graph.links.filter((link) => link.kind === 'wiki').length} />
            <StatTile label="Тегов" value={graph.nodes.filter((node) => node.kind === 'tag').length} />
            <StatTile label="Вложений" value={notes.reduce((sum, note) => sum + (note.attachments?.length ?? 0), 0)} />
          </div>
        </div>

        <input
          className="input notes-search notes-search--list"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Найти заметку"
        />

        <div className="stack">
          {filteredNotes.map((note) => {
            const tags = parseNoteTags(note.body);
            return (
              <div
                key={note.id}
                className="note-row"
                onClick={() => {
                  selectionChanged();
                  navigate(`/notes/${note.id}`);
                }}
                role="button"
              >
                <div className="note-row__top">
                  <div className="note-row__title">{note.title}</div>
                  <div className="note-row__date">{noteDateFmt.format(new Date(note.updatedAt))}</div>
                </div>
                <div className="note-row__body">{noteSnippet(note)}</div>
                {(tags.length > 0 || note.attachments?.length) && (
                  <div className="note-row__tags">
                    {tags.slice(0, 3).map((tag) => (
                      <span key={tag}>#{tag}</span>
                    ))}
                    {!!note.attachments?.length && <span>{note.attachments.length} файл.</span>}
                  </div>
                )}
              </div>
            );
          })}
          {!filteredNotes.length && (
            <EmptyState
              icon="📝"
              title={notes.length ? 'Ничего не найдено' : 'Заметок пока нет'}
              sub={notes.length ? 'Попробуйте другой поиск' : 'Создайте первую запись'}
            />
          )}
        </div>
      </div>
    </Screen>
  );
}
