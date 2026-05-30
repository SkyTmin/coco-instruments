import { useEffect, useMemo, useState } from 'react';
import { Screen, ConfirmDialog, StatTile } from '@/components/ui';
import { IconGraph, IconPlus, IconTrash } from '@/components/icons';
import type { Note } from '@/types';
import { useFinanceStore } from '@/store';
import {
  GRAPH_VIEW_BOX,
  buildNoteGraph,
  filterNoteGraph,
  getNoteRelations,
  layoutNoteGraph,
  normalizeNoteTitle,
  parseNoteTags,
} from '@/lib/notes-graph';
import { notifySuccess, selectionChanged, tapLight } from '@/lib/haptics';

const dateTimeFmt = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

function snippet(note: Note): string {
  const clean = note.body
    .replace(/\[\[([^[\]|#]+)(?:#[^[\]|]+)?(?:\|([^[\]]+))?\]\]/g, '$2$1')
    .replace(/(^|[^#\p{L}\p{N}_-])#[\p{L}\p{N}_][\p{L}\p{N}_-]{0,31}/gu, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return clean || 'Пустая заметка';
}

function shortLabel(value: string, max = 17): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function NoteGraphView({
  graph,
  activeId,
  onPick,
}: {
  graph: ReturnType<typeof buildNoteGraph>;
  activeId?: string;
  onPick: (id: string) => void;
}) {
  const points = useMemo(() => layoutNoteGraph(graph, activeId), [graph, activeId]);
  const byId = useMemo(() => new Map(points.map((point) => [point.id, point])), [points]);

  if (!points.length) {
    return (
      <div className="notes-graph-empty">
        <IconGraph size={34} />
        <div>Нет связей</div>
      </div>
    );
  }

  return (
    <svg
      className="notes-graph"
      viewBox={`0 0 ${GRAPH_VIEW_BOX.width} ${GRAPH_VIEW_BOX.height}`}
      role="img"
      aria-label="Граф заметок"
    >
      <defs>
        <linearGradient id="noteNodeGradient" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--accent-grad-1)" />
          <stop offset="100%" stopColor="var(--accent-grad-2)" />
        </linearGradient>
      </defs>
      {graph.links.map((link) => {
        const source = byId.get(link.source);
        const target = byId.get(link.target);
        if (!source || !target) return null;
        return (
          <line
            key={link.id}
            className={`notes-graph__link notes-graph__link--${link.kind}`}
            x1={source.x}
            y1={source.y}
            x2={target.x}
            y2={target.y}
          />
        );
      })}
      {points.map((point) => {
        const isNote = point.kind === 'note';
        const selected = point.id === activeId;
        return (
          <g
            key={point.id}
            className={`notes-graph__node notes-graph__node--${point.kind}${selected ? ' is-active' : ''}`}
            onClick={() => {
              if (!isNote) return;
              tapLight();
              onPick(point.id);
            }}
          >
            <title>{point.label}</title>
            <circle cx={point.x} cy={point.y} r={point.r} />
            <text x={point.x} y={point.y + point.r + 15}>
              {shortLabel(point.label)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function NotesPage() {
  const notes = useFinanceStore((s) => s.notes);
  const addNote = useFinanceStore((s) => s.addNote);
  const updateNote = useFinanceStore((s) => s.updateNote);
  const removeNote = useFinanceStore((s) => s.removeNote);

  const [activeId, setActiveId] = useState<string | undefined>(undefined);
  const [creating, setCreating] = useState(true);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'global' | 'local'>('global');
  const [depth, setDepth] = useState(2);
  const [showMissing, setShowMissing] = useState(true);
  const [showTags, setShowTags] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const activeNote = useMemo(
    () => notes.find((note) => note.id === activeId),
    [activeId, notes],
  );

  useEffect(() => {
    if (!notes.length) {
      setCreating(true);
      setActiveId(undefined);
      return;
    }
    if (!activeId || !notes.some((note) => note.id === activeId)) {
      setActiveId(notes[0].id);
      setCreating(false);
    }
  }, [activeId, notes]);

  useEffect(() => {
    if (creating || !activeNote) return;
    setTitle(activeNote.title);
    setBody(activeNote.body);
  }, [activeNote, creating]);

  const graph = useMemo(() => buildNoteGraph(notes), [notes]);
  const visibleGraph = useMemo(
    () =>
      filterNoteGraph(graph, {
        mode,
        activeId,
        depth,
        showMissing,
        showTags,
        query,
      }),
    [activeId, depth, graph, mode, query, showMissing, showTags],
  );
  const relations = useMemo(() => getNoteRelations(activeNote, notes), [activeNote, notes]);

  const normalizedTitle = normalizeNoteTitle(title);
  const hasDuplicate = notes.some(
    (note) => note.id !== activeNote?.id && normalizeNoteTitle(note.title) === normalizedTitle,
  );
  const canSave = normalizedTitle.length > 0 && !hasDuplicate;
  const linkCount = graph.links.filter((link) => link.kind === 'wiki').length;
  const missingCount = graph.nodes.filter((node) => node.kind === 'missing').length;
  const noteQuery = normalizeNoteTitle(query);
  const filteredNotes = notes.filter((note) => {
    if (!noteQuery) return true;
    return normalizeNoteTitle(`${note.title} ${note.body}`).includes(noteQuery);
  });

  const startNew = () => {
    tapLight();
    setCreating(true);
    setTitle('');
    setBody('');
  };

  const pickNote = (id: string) => {
    selectionChanged();
    setCreating(false);
    setActiveId(id);
  };

  const save = () => {
    if (!canSave) return;
    if (creating) {
      const note = addNote({ title, body });
      setActiveId(note.id);
      setCreating(false);
    } else if (activeNote) {
      updateNote(activeNote.id, { title, body });
    }
    notifySuccess();
  };

  const createFromLink = (linkTitle: string) => {
    const note = addNote({ title: linkTitle, body: '' });
    setActiveId(note.id);
    setCreating(false);
    notifySuccess();
  };

  const deleteActive = () => {
    if (!activeNote) return;
    removeNote(activeNote.id);
    setConfirmDelete(false);
    setCreating(true);
    setTitle('');
    setBody('');
    notifySuccess();
  };

  return (
    <Screen
      title="Заметки"
      subtitle="Связи, теги и граф"
      action={
        <button className="btn btn--primary notes-head-action" onClick={startNew}>
          <IconPlus size={18} />
          Новая
        </button>
      }
    >
      <div className="stack notes-page">
        <div className="card">
          <div className="stat-grid">
            <StatTile label="Заметок" value={notes.length} />
            <StatTile label="Связей" value={linkCount} />
            <StatTile label="Тегов" value={graph.nodes.filter((node) => node.kind === 'tag').length} />
            <StatTile label="Без файла" value={missingCount} />
          </div>
        </div>

        <div className="card notes-graph-card">
          <div className="notes-card-head">
            <div>
              <div className="notes-card-title">Граф</div>
              <div className="notes-card-sub">
                {mode === 'local' && activeNote ? activeNote.title : 'Вся база'}
              </div>
            </div>
            <IconGraph />
          </div>

          <div className="segmented">
            <button
              className={`segmented__opt${mode === 'global' ? ' is-active' : ''}`}
              onClick={() => {
                selectionChanged();
                setMode('global');
              }}
            >
              Глобальный
            </button>
            <button
              className={`segmented__opt${mode === 'local' ? ' is-active' : ''}`}
              onClick={() => {
                selectionChanged();
                setMode('local');
              }}
            >
              Локальный
            </button>
          </div>

          <div className="notes-toolbar">
            <input
              className="input notes-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск"
            />
            <button
              className={`notes-toggle${showTags ? ' is-active' : ''}`}
              onClick={() => setShowTags((value) => !value)}
            >
              Теги
            </button>
            <button
              className={`notes-toggle${showMissing ? ' is-active' : ''}`}
              onClick={() => setShowMissing((value) => !value)}
            >
              Связи
            </button>
          </div>

          {mode === 'local' && (
            <div className="notes-depth">
              {[1, 2, 3].map((value) => (
                <button
                  key={value}
                  className={`notes-depth__btn${depth === value ? ' is-active' : ''}`}
                  onClick={() => setDepth(value)}
                >
                  {value}
                </button>
              ))}
            </div>
          )}

          <NoteGraphView graph={visibleGraph} activeId={activeId} onPick={pickNote} />
        </div>

        <div className="card notes-editor">
          <div className="notes-card-head">
            <div>
              <div className="notes-card-title">{creating ? 'Новая заметка' : 'Редактор'}</div>
              <div className="notes-card-sub">
                {activeNote && !creating ? dateTimeFmt.format(new Date(activeNote.updatedAt)) : 'Черновик'}
              </div>
            </div>
            {activeNote && !creating && (
              <button className="icon-btn" onClick={() => setConfirmDelete(true)} aria-label="Удалить">
                <IconTrash size={20} />
              </button>
            )}
          </div>

          <div className="field">
            <label className="field__label">Название</label>
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Идея"
            />
          </div>

          <div className="field">
            <label className="field__label">Текст</label>
            <textarea
              className="input notes-textarea"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Связь: [[Проект]]&#10;#идея"
            />
          </div>

          {hasDuplicate && <div className="notes-error">Такое название уже есть</div>}

          <button className="btn btn--primary btn--block" disabled={!canSave} onClick={save}>
            {creating ? 'Создать' : 'Сохранить'}
          </button>

          {activeNote && !creating && (
            <div className="notes-relations">
              <div className="notes-relation-row">
                <span>Исходящие</span>
                <div>
                  {relations.outgoing.length ? (
                    relations.outgoing.map((note) => (
                      <button key={note.id} className="note-chip" onClick={() => pickNote(note.id)}>
                        {note.title}
                      </button>
                    ))
                  ) : (
                    <em>нет</em>
                  )}
                </div>
              </div>
              <div className="notes-relation-row">
                <span>Обратные</span>
                <div>
                  {relations.backlinks.length ? (
                    relations.backlinks.map((note) => (
                      <button key={note.id} className="note-chip" onClick={() => pickNote(note.id)}>
                        {note.title}
                      </button>
                    ))
                  ) : (
                    <em>нет</em>
                  )}
                </div>
              </div>
              {relations.missing.length > 0 && (
                <div className="notes-relation-row">
                  <span>Без файла</span>
                  <div>
                    {relations.missing.map((item) => (
                      <button key={item} className="note-chip note-chip--new" onClick={() => createFromLink(item)}>
                        + {item}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {relations.tags.length > 0 && (
                <div className="notes-relation-row">
                  <span>Теги</span>
                  <div>
                    {relations.tags.map((tag) => (
                      <span key={tag} className="note-chip note-chip--tag">
                        #{tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="section-label">База</div>
        <div className="stack">
          {filteredNotes.map((note) => {
            const tags = parseNoteTags(note.body);
            return (
              <div
                key={note.id}
                className={`note-row${note.id === activeId && !creating ? ' is-active' : ''}`}
                onClick={() => pickNote(note.id)}
                role="button"
              >
                <div className="note-row__title">{note.title}</div>
                <div className="note-row__body">{snippet(note)}</div>
                {tags.length > 0 && (
                  <div className="note-row__tags">
                    {tags.slice(0, 3).map((tag) => (
                      <span key={tag}>#{tag}</span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {!filteredNotes.length && (
            <div className="card center muted">Пока пусто</div>
          )}
        </div>
      </div>

      {confirmDelete && activeNote && (
        <ConfirmDialog
          title="Удалить заметку?"
          message={`«${activeNote.title}» исчезнет из базы. Ссылки на неё останутся как пустые.`}
          onClose={() => setConfirmDelete(false)}
          onConfirm={deleteActive}
        />
      )}
    </Screen>
  );
}
