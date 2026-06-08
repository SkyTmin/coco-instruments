import { useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { EmptyState, Screen, SwipeRow } from '@/components/ui';
import { IconGraph, IconNotes, IconTrash } from '@/components/icons';
import { useFinanceStore } from '@/store';
import { normalizeNoteTitle, parseNoteTags } from '@/lib/notes-graph';
import { noteDateFmt, noteSnippet } from '@/pages/NotesPage';
import { notifyWarning, selectionChanged, tapLight } from '@/lib/haptics';

export function NoteListDetailPage() {
  const navigate = useNavigate();
  const { listId } = useParams();
  const list = useFinanceStore((s) => (listId ? s.getNoteList(listId) : undefined));
  const notes = useFinanceStore((s) => s.notes);
  const removeNote = useFinanceStore((s) => s.removeNote);
  const hydrated = useFinanceStore((s) => s.hydrated);
  const [query, setQuery] = useState('');

  const all = useMemo(
    () => notes.filter((n) => n.listId === listId).sort((a, b) => b.updatedAt - a.updatedAt),
    [notes, listId],
  );
  const queryKey = normalizeNoteTitle(query);
  const filtered = useMemo(() => {
    if (!queryKey) return all;
    return all.filter((n) => normalizeNoteTitle(`${n.title} ${n.body}`).includes(queryKey));
  }, [all, queryKey]);

  if (hydrated && listId && !list) return <Navigate to="/notes/lists" replace />;

  const go = (path: string) => {
    tapLight();
    navigate(path);
  };

  return (
    <Screen
      title={list ? `${list.emoji ? `${list.emoji} ` : ''}${list.name}` : 'Список'}
      subtitle={all.length ? `${all.length} зам.` : 'Заметки этого списка'}
    >
      <div className="stack notes-page">
        <div className="notes-actions">
          <button className="notes-action notes-action--primary" onClick={() => go(`/notes/new?list=${listId}`)}>
            <IconNotes />
            <span>Новая заметка</span>
          </button>
          <button className="notes-action" onClick={() => go(`/notes/graph?list=${listId}`)}>
            <IconGraph />
            <span>Граф списка</span>
          </button>
        </div>

        <div className="notes-search-wrap">
          <input
            className="input notes-search notes-search--list"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Найти в списке"
          />
          {query && (
            <button className="notes-search__clear" onClick={() => setQuery('')} aria-label="Очистить">
              ×
            </button>
          )}
        </div>

        <div className="stack">
          {filtered.map((note, i) => {
            const tags = parseNoteTags(note.body);
            const thumb = note.attachments?.find((a) => a.type.startsWith('image/'));
            return (
              <SwipeRow
                key={note.id}
                onTap={() => {
                  selectionChanged();
                  navigate(`/notes/${note.id}`);
                }}
                actions={[
                  {
                    icon: <IconTrash size={20} />,
                    label: 'Удалить',
                    danger: true,
                    onClick: () => {
                      notifyWarning();
                      removeNote(note.id);
                    },
                  },
                ]}
              >
                <div className="note-row" style={{ animationDelay: `${Math.min(i, 12) * 28}ms` }}>
                  <div className="note-row__main">
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
                        {!!note.attachments?.length && <span className="is-attach">{note.attachments.length} файл.</span>}
                      </div>
                    )}
                  </div>
                  {thumb && (
                    <div className="note-row__thumb">
                      <img src={thumb.url ?? thumb.dataUrl} alt="" loading="lazy" />
                    </div>
                  )}
                </div>
              </SwipeRow>
            );
          })}
          {!filtered.length && (
            <EmptyState
              icon="📝"
              title={all.length ? 'Ничего не найдено' : 'В этом списке пусто'}
              sub={all.length ? 'Попробуйте другой запрос' : 'Создайте первую заметку списка'}
            />
          )}
        </div>
      </div>
    </Screen>
  );
}
