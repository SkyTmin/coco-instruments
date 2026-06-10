import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatedNumber, EmptyState, Fab, Screen, Skeleton, SwipeRow } from '@/components/ui';
import { IconGraph, IconPin, IconTrash } from '@/components/icons';
import type { Note } from '@/types';
import { useFinanceStore } from '@/store';
import { NotesHelpButton } from '@/components/NotesGuide';
import { tagColor } from '@/lib/tag-color';
import { normalizeNoteTitle, parseNoteTags } from '@/lib/notes-graph';
import { noteExcerpt } from '@/lib/notes-markdown';
import { notifyWarning, selectionChanged, tapLight } from '@/lib/haptics';

const dayFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });
const clockFmt = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
const weekdayFmt = new Intl.DateTimeFormat('ru-RU', { weekday: 'short' });

/** Human, "today-brain" timestamps: только что · 14:30 · вчера · Пн · 9 июн. */
export function relativeDate(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'только что';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} мин`;
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(new Date()) - startOfDay(new Date(ts))) / 86_400_000);
  if (days <= 0) return clockFmt.format(new Date(ts));
  if (days === 1) return 'вчера';
  if (days < 7) return weekdayFmt.format(new Date(ts));
  return dayFmt.format(new Date(ts));
}

export function noteSnippet(note: Note): string {
  const clean = noteExcerpt(note.body);
  if (clean) return clean;
  if (note.attachments?.length) return `Вложений: ${note.attachments.length}`;
  return 'Пустая заметка';
}

function firstImage(note: Note) {
  return note.attachments?.find((a) => a.type.startsWith('image/'));
}

function plural(n: number, one: string, few: string, many: string): string {
  const a = n % 10;
  const b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 10 || b >= 20)) return few;
  return many;
}

export function NotesPage() {
  const navigate = useNavigate();
  const notes = useFinanceStore((s) => s.notes);
  const noteLists = useFinanceStore((s) => s.noteLists);
  const removeNote = useFinanceStore((s) => s.removeNote);
  const setNotePinned = useFinanceStore((s) => s.setNotePinned);
  const hydrated = useFinanceStore((s) => s.hydrated);
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [listFilter, setListFilter] = useState<string | null>(null);

  useEffect(() => {
    const q = params.get('q');
    if (q !== null) setQuery(q);
  }, [params]);

  const listById = useMemo(() => new Map(noteLists.map((l) => [l.id, l])), [noteLists]);
  const countByList = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of notes) if (n.listId) m.set(n.listId, (m.get(n.listId) ?? 0) + 1);
    return m;
  }, [notes]);
  const queryKey = normalizeNoteTitle(query);

  const visible = useMemo(() => {
    let list = notes;
    if (listFilter) list = list.filter((n) => n.listId === listFilter);
    if (queryKey)
      list = list.filter((n) => normalizeNoteTitle(`${n.title} ${n.body}`).includes(queryKey));
    return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [notes, listFilter, queryKey]);

  const searching = !!queryKey;
  const pinned = useMemo(() => visible.filter((n) => n.pinned), [visible]);
  const recent = useMemo(() => visible.filter((n) => !n.pinned), [visible]);

  const activeList = listFilter ? listById.get(listFilter) : undefined;
  const createPath = listFilter ? `/notes/new?list=${listFilter}` : '/notes/new';
  const graphPath = listFilter ? `/notes/graph?list=${listFilter}` : '/notes/graph';

  const setSearch = (value: string) => {
    setQuery(value);
    if (params.has('q')) setParams({}, { replace: true });
  };
  const go = (path: string) => {
    tapLight();
    navigate(path);
  };

  const renderCard = (note: Note, i: number) => {
    const tags = parseNoteTags(note.body);
    const thumb = firstImage(note);
    const list = note.listId ? listById.get(note.listId) : undefined;
    const showList = list && !listFilter;
    return (
      <SwipeRow
        key={note.id}
        onTap={() => {
          selectionChanged();
          navigate(`/notes/${note.id}`);
        }}
        actions={[
          {
            icon: <IconPin size={19} />,
            label: note.pinned ? 'Открепить' : 'Закрепить',
            onClick: () => {
              selectionChanged();
              setNotePinned(note.id, !note.pinned);
            },
          },
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
        <div
          className={`note-row${note.pinned ? ' is-pinned' : ''}`}
          style={{ animationDelay: `${Math.min(i, 12) * 26}ms` }}
        >
          <div className="note-row__main">
            <div className="note-row__top">
              <div className="note-row__title">
                {note.pinned && <IconPin size={12} className="note-row__pin" />}
                {note.title || 'Без названия'}
              </div>
              <div className="note-row__date">{relativeDate(note.updatedAt)}</div>
            </div>
            <div className="note-row__body">{noteSnippet(note)}</div>
            {(tags.length > 0 || note.attachments?.length || showList) && (
              <div className="note-row__tags">
                {showList && (
                  <span className="is-list">
                    {list?.emoji ?? '📋'} {list?.name}
                  </span>
                )}
                {tags.slice(0, 3).map((tag) => {
                  const tc = tagColor(tag);
                  return (
                    <span key={tag} style={{ color: tc.stroke, background: tc.chipBg }}>
                      #{tag}
                    </span>
                  );
                })}
                {!!note.attachments?.length && (
                  <span className="is-attach">{note.attachments.length} 📎</span>
                )}
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
  };

  if (!hydrated) {
    return (
      <Screen title="Заметки" subtitle="Быстрые записи и связи" action={<NotesHelpButton />}>
        <div className="stack notes-page">
          <Skeleton height={46} radius={999} />
          <Skeleton height={36} radius={999} />
          <Skeleton height={86} radius={20} />
          <Skeleton height={86} radius={20} />
          <Skeleton height={86} radius={20} />
        </div>
      </Screen>
    );
  }

  const firstRun = notes.length === 0;

  return (
    <Screen
      title="Заметки"
      subtitle={
        activeList ? (
          <>
            <AnimatedNumber value={visible.length} /> в «{activeList.name}»
          </>
        ) : (
          <>
            <AnimatedNumber value={notes.length} />{' '}
            {plural(notes.length, 'заметка', 'заметки', 'заметок')}
          </>
        )
      }
      action={
        <div className="notes-head-actions">
          {notes.length > 0 && (
            <button className="icon-btn" onClick={() => go(graphPath)} aria-label="Граф связей">
              <IconGraph size={21} />
            </button>
          )}
          <NotesHelpButton />
        </div>
      }
    >
      <div className="stack notes-page">
        {!firstRun && (
          <>
            <div className="notes-search-wrap">
              <input
                className="input notes-search notes-search--list"
                value={query}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                placeholder="Поиск по заметкам и #тегам"
              />
              {query && (
                <button
                  className="notes-search__clear"
                  onClick={() => setSearch('')}
                  aria-label="Очистить"
                >
                  ×
                </button>
              )}
            </div>

            <div className="notes-chips">
              <button
                className={`notes-chip${!listFilter ? ' is-active' : ''}`}
                onClick={() => {
                  selectionChanged();
                  setListFilter(null);
                }}
              >
                Все<span className="notes-chip__count">{notes.length}</span>
              </button>
              {noteLists.map((l) => (
                <button
                  key={l.id}
                  className={`notes-chip${listFilter === l.id ? ' is-active' : ''}`}
                  onClick={() => {
                    selectionChanged();
                    setListFilter(listFilter === l.id ? null : l.id);
                  }}
                >
                  {l.emoji && <span className="notes-chip__emoji">{l.emoji}</span>}
                  {l.name}
                  <span className="notes-chip__count">{countByList.get(l.id) ?? 0}</span>
                </button>
              ))}
              <button
                className="notes-chip notes-chip--add"
                onClick={() => go('/notes/lists')}
                aria-label="Списки"
              >
                +
              </button>
            </div>
          </>
        )}

        {firstRun ? (
          <div className="notes-welcome">
            <div className="notes-welcome__icon">📝</div>
            <h2 className="notes-welcome__title">Заметки-чаты</h2>
            <p className="notes-welcome__sub">
              Пишите как в мессенджере — текстом и фото. Связывайте мысли, группируйте по спискам и
              находите всё в графе.
            </p>
            <button className="btn btn--primary btn--block" onClick={() => go('/notes/new')}>
              Создать первую заметку
            </button>
            <div className="notes-welcome__feats">
              <div>
                <b>[[ ]]</b> связи между заметками
              </div>
              <div>
                <b>#тег</b> темы и подтемы
              </div>
              <div>
                <b>📋</b> списки-тетради
              </div>
            </div>
          </div>
        ) : searching ? (
          <div className="stack">
            {visible.length ? (
              visible.map(renderCard)
            ) : (
              <EmptyState
                icon="🔍"
                title="Ничего не найдено"
                sub="Попробуйте другой запрос или тег"
              />
            )}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={activeList?.emoji ?? '📋'}
            title={`В «${activeList?.name}» пусто`}
            sub="Создайте здесь первую заметку — кнопкой + внизу"
          />
        ) : (
          <div className="stack">
            {pinned.length > 0 && (
              <>
                <div className="notes-section-head">
                  <IconPin size={12} /> Закреплённые
                </div>
                {pinned.map(renderCard)}
              </>
            )}
            {recent.length > 0 && (
              <>
                <div className="notes-section-head">
                  {pinned.length > 0 ? 'Остальные' : activeList ? activeList.name : 'Недавние'}
                </div>
                {recent.map(renderCard)}
              </>
            )}
          </div>
        )}

        {!firstRun && <div className="notes-fab-spacer" />}
      </div>

      {!firstRun && <Fab onClick={() => go(createPath)} />}
    </Screen>
  );
}
