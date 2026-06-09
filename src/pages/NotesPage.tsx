import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { EmptyState, Screen, Skeleton, StatTile, SwipeRow } from '@/components/ui';
import { IconGraph, IconList, IconNotes, IconTrash } from '@/components/icons';
import type { Note } from '@/types';
import { useFinanceStore } from '@/store';
import { NotesHelpButton } from '@/components/NotesGuide';
import { tagColor } from '@/lib/tag-color';
import { buildNoteGraph, normalizeNoteTitle, parseNoteTags } from '@/lib/notes-graph';
import { noteExcerpt } from '@/lib/notes-markdown';
import { notifyWarning, selectionChanged, tapLight } from '@/lib/haptics';

export const noteDateFmt = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export function noteSnippet(note: Note): string {
  const clean = noteExcerpt(note.body);
  if (clean) return clean;
  if (note.attachments?.length) return `Вложений: ${note.attachments.length}`;
  return 'Пустая заметка';
}

function firstImage(note: Note) {
  return note.attachments?.find((a) => a.type.startsWith('image/'));
}

export function NotesPage() {
  const navigate = useNavigate();
  const notes = useFinanceStore((s) => s.notes);
  const noteLists = useFinanceStore((s) => s.noteLists);
  const removeNote = useFinanceStore((s) => s.removeNote);
  const hydrated = useFinanceStore((s) => s.hydrated);
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');

  // Keep the field in sync when arriving via a #tag link from a note.
  useEffect(() => {
    const q = params.get('q');
    if (q !== null) setQuery(q);
  }, [params]);

  const graph = useMemo(() => buildNoteGraph(notes), [notes]);
  const listById = useMemo(() => new Map(noteLists.map((l) => [l.id, l])), [noteLists]);
  const queryKey = normalizeNoteTitle(query);
  const filteredNotes = useMemo(() => {
    const list = [...notes].sort((a, b) => b.updatedAt - a.updatedAt);
    if (!queryKey) return list;
    return list.filter((note) =>
      normalizeNoteTitle(`${note.title} ${note.body}`).includes(queryKey),
    );
  }, [notes, queryKey]);

  const setSearch = (value: string) => {
    setQuery(value);
    // Drop the ?q= once the user edits the field, so Back behaves predictably.
    if (params.has('q')) setParams({}, { replace: true });
  };

  const go = (path: string) => {
    tapLight();
    navigate(path);
  };

  if (!hydrated) {
    return (
      <Screen title="Заметки" subtitle="Быстрые записи и связи" action={<NotesHelpButton />}>
        <div className="stack notes-page">
          <div className="notes-actions">
            <Skeleton height={74} radius={18} />
            <Skeleton height={74} radius={18} />
          </div>
          <Skeleton height={96} radius={20} />
          <Skeleton height={48} radius={13} />
          <Skeleton height={84} radius={18} />
          <Skeleton height={84} radius={18} />
        </div>
      </Screen>
    );
  }

  return (
    <Screen
      title="Заметки"
      subtitle={notes.length ? `${notes.length} зам. · ${graph.links.filter((l) => l.kind === 'wiki').length} связей` : 'Быстрые записи и связи'}
      action={<NotesHelpButton />}
    >
      <div className="stack notes-page">
        <div className="notes-actions">
          <button className="notes-action notes-action--primary" onClick={() => go('/notes/new')}>
            <span className="notes-action__icon"><IconNotes /></span>
            <span>Новая заметка</span>
          </button>
          <button className="notes-action notes-action--lists" onClick={() => go('/notes/lists')}>
            <span className="notes-action__icon"><IconList /></span>
            <span>Списки</span>
          </button>
          <button className="notes-action notes-action--graph" onClick={() => go('/notes/graph')}>
            <span className="notes-action__icon"><IconGraph /></span>
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

        <div className="notes-search-wrap">
          <input
            className="input notes-search notes-search--list"
            value={query}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Найти заметку или #тег"
          />
          {query && (
            <button className="notes-search__clear" onClick={() => setSearch('')} aria-label="Очистить">
              ×
            </button>
          )}
        </div>

        <div className="stack">
          {filteredNotes.map((note, i) => {
            const tags = parseNoteTags(note.body);
            const thumb = firstImage(note);
            const list = note.listId ? listById.get(note.listId) : undefined;
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
                    {(tags.length > 0 || note.attachments?.length || list) && (
                      <div className="note-row__tags">
                        {list && (
                          <span className="is-list">
                            {list.emoji ?? '📋'} {list.name}
                          </span>
                        )}
                        {tags.slice(0, 3).map((tag) => {
                          const tc = tagColor(tag);
                          return (
                            <span key={tag} style={{ color: tc.stroke, background: tc.chipBg }}>#{tag}</span>
                          );
                        })}
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
          {!filteredNotes.length && (
            <EmptyState
              icon="📝"
              title={notes.length ? 'Ничего не найдено' : 'Заметок пока нет'}
              sub={notes.length ? 'Попробуйте другой запрос' : 'Создайте первую запись'}
            />
          )}
        </div>
      </div>
    </Screen>
  );
}
