import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ConfirmDialog, Sheet } from '@/components/ui';
import { ChatThread } from '@/components/ChatThread';
import { NotePicker } from '@/components/NotePicker';
import { NotesGuide } from '@/components/NotesGuide';
import { IconBack, IconDots, IconGraph, IconHeart, IconLink } from '@/components/icons';
import type { NoteAttachment } from '@/types';
import { useFinanceStore } from '@/store';
import { isWebMode } from '@/lib/runtime';
import { getNoteRelations, parseNoteTags } from '@/lib/notes-graph';
import type { MessageExtra } from '@/lib/notes-messages';
import { deriveFromMessages, makeMessage, materializeMessages } from '@/lib/notes-messages';
import { buildMessageLink } from '@/lib/notes-markdown';
import { notifySuccess, selectionChanged, tapLight } from '@/lib/haptics';

export function ChatNotePage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const notes = useFinanceStore((s) => s.notes);
  const note = useFinanceStore((s) => (id ? s.getNote(id) : undefined));
  const hydrated = useFinanceStore((s) => s.hydrated);
  const noteLists = useFinanceStore((s) => s.noteLists);
  const people = useFinanceStore((s) => s.people);
  const personNoteLinks = useFinanceStore((s) => s.personNoteLinks);

  const addNote = useFinanceStore((s) => s.addNote);
  const addNoteList = useFinanceStore((s) => s.addNoteList);
  const addNoteMessage = useFinanceStore((s) => s.addNoteMessage);
  const updateNoteMessage = useFinanceStore((s) => s.updateNoteMessage);
  const removeNoteMessage = useFinanceStore((s) => s.removeNoteMessage);
  const removeNoteMessages = useFinanceStore((s) => s.removeNoteMessages);
  const setNoteMessagePinned = useFinanceStore((s) => s.setNoteMessagePinned);
  const updateNote = useFinanceStore((s) => s.updateNote);
  const removeNote = useFinanceStore((s) => s.removeNote);
  const linkNoteToPerson = useFinanceStore((s) => s.linkNoteToPerson);
  const unlinkNoteFromPerson = useFinanceStore((s) => s.unlinkNoteFromPerson);

  const currentId = useRef<string | undefined>(id);
  currentId.current = id ?? currentId.current;
  const deleted = useRef(false);

  const [title, setTitle] = useState(note?.title ?? '');
  const [listId, setListId] = useState<string | undefined>(
    note?.listId ?? searchParams.get('list') ?? undefined,
  );
  const [menu, setMenu] = useState(false);
  const [guide, setGuide] = useState(false);
  const [linksSheet, setLinksSheet] = useState(false);
  const [listSheet, setListSheet] = useState(false);
  const [newListOpen, setNewListOpen] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [linkPick, setLinkPick] = useState(false);
  const [peopleSheet, setPeopleSheet] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const loadedId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!note || note.id === loadedId.current) return;
    loadedId.current = note.id;
    setTitle(note.title);
    setListId(note.listId);
  }, [note]);

  const listById = useMemo(() => new Map(noteLists.map((l) => [l.id, l])), [noteLists]);
  const activeList = listId ? listById.get(listId) : undefined;
  const messages = useMemo(() => (note ? materializeMessages(note) : []), [note]);
  const tags = useMemo(() => (note ? parseNoteTags(note.body) : []), [note]);
  const relations = useMemo(() => getNoteRelations(note, notes), [note, notes]);
  const linkedPeople = useMemo(() => {
    const noteId = currentId.current;
    if (!noteId) return [];
    const ids = new Set(personNoteLinks.filter((l) => l.noteId === noteId).map((l) => l.personId));
    return people.filter((p) => ids.has(p.id));
  }, [people, personNoteLinks]);
  const connections = relations.outgoing.length + relations.backlinks.length + linkedPeople.length;

  if (id && hydrated && !note && !deleted.current) return <Navigate to="/notes" replace />;

  const saveTitle = () => {
    const t = title.trim();
    if (currentId.current && t && t !== note?.title) updateNote(currentId.current, { title: t });
  };

  const ensureNote = (firstText: string, atts: NoteAttachment[], extra?: MessageExtra) => {
    const msg = makeMessage(firstText, atts, extra);
    const derived = deriveFromMessages([msg]);
    const t =
      title.trim() ||
      firstText.split('\n')[0].trim().slice(0, 60) ||
      derived.body.split('\n')[0].trim().slice(0, 60) ||
      'Заметка';
    const created = addNote({
      title: t,
      messages: [msg],
      body: derived.body,
      attachments: derived.attachments,
      listId,
    });
    currentId.current = created.id;
    loadedId.current = created.id;
    if (!title.trim()) setTitle(t);
    navigate(`/notes/${created.id}`, { replace: true });
  };

  const onSend = (text: string, atts: NoteAttachment[], extra?: MessageExtra) => {
    if (currentId.current) addNoteMessage(currentId.current, text, atts, extra);
    else ensureNote(text, atts, extra);
  };

  const openMessage = (kind: 'n' | 't', ref: string, mid: string) => {
    if (kind === 'n') navigate(`/notes/${ref}?msg=${mid}`);
    else navigate(`/notes/tag/${encodeURIComponent(ref)}?msg=${mid}`);
  };

  const pickList = (newListId: string | undefined) => {
    selectionChanged();
    setListId(newListId);
    if (currentId.current) updateNote(currentId.current, { listId: newListId });
  };

  // Create a list right from the picker sheet and put the note into it.
  const createListHere = () => {
    const name = newListName.trim();
    if (!name) return;
    const created = addNoteList(name);
    pickList(created.id);
    notifySuccess();
    setNewListName('');
    setNewListOpen(false);
    setListSheet(false);
  };

  const detachPerson = (personId: string) => {
    if (currentId.current) unlinkNoteFromPerson(personId, currentId.current);
    selectionChanged();
  };

  const deleteNote = () => {
    deleted.current = true;
    if (currentId.current) removeNote(currentId.current);
    setConfirmDelete(false);
    notifySuccess();
    navigate('/notes', { replace: true });
  };

  const openTag = (t: string) => navigate(`/notes/tag/${encodeURIComponent(t)}`);

  return (
    <div className="chat-page">
      <div className="chat-head">
        {isWebMode() && (
          <button
            className="icon-btn chat-back"
            onClick={() => {
              tapLight();
              if (window.history.length > 1) navigate(-1);
              else navigate('/notes');
            }}
            aria-label="Назад"
          >
            <IconBack size={20} />
          </button>
        )}
        <input
          className="chat-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          placeholder="Название заметки"
        />
        <button
          className="icon-btn"
          onClick={() => {
            tapLight();
            navigate('/notes/graph');
          }}
          aria-label="Граф связей"
        >
          <IconGraph size={20} />
        </button>
        <button
          className="icon-btn"
          onClick={() => {
            tapLight();
            setMenu(true);
          }}
          aria-label="Меню заметки"
        >
          <IconDots size={20} />
        </button>
      </div>

      {/* Meta bar — always visible: где лежит заметка, её теги, связи. */}
      <div className="note-meta">
        <button
          className="note-meta__chip note-meta__list"
          onClick={() => {
            tapLight();
            if (!currentId.current && !noteLists.length) navigate('/notes/lists');
            else setListSheet(true);
          }}
        >
          {activeList ? `${activeList.emoji ?? '📋'} ${activeList.name}` : '＋ Список'}
        </button>
        {tags.map((t) => (
          <button key={t} className="note-meta__chip note-meta__tag" onClick={() => openTag(t)}>
            #{t}
          </button>
        ))}
        {note && (
          <button
            className="note-meta__chip note-meta__links"
            onClick={() => {
              tapLight();
              setLinksSheet(true);
            }}
          >
            <IconLink size={13} /> Связи{connections ? ` · ${connections}` : ''}
          </button>
        )}
      </div>

      <ChatThread
        messages={messages}
        notes={notes}
        emptyTitle="Ваше пространство для мыслей"
        placeholder="Новая мысль…"
        focusMessageId={searchParams.get('msg')}
        onSend={onSend}
        onEditMessage={(mid, text, atts, extra) =>
          currentId.current && updateNoteMessage(currentId.current, mid, text, atts, extra)
        }
        onDeleteMessage={(mid) => currentId.current && removeNoteMessage(currentId.current, mid)}
        onDeleteMessages={(ids) => currentId.current && removeNoteMessages(currentId.current, ids)}
        onTogglePin={(mid, pinned) =>
          currentId.current && setNoteMessagePinned(currentId.current, mid, pinned)
        }
        messageLink={(m) =>
          currentId.current ? buildMessageLink('n', currentId.current, m.id) : null
        }
        onOpenNote={(nid) => navigate(`/notes/${nid}`)}
        onOpenMissing={(t) => {
          const created = useFinanceStore.getState().addNote({ title: t, body: '', listId });
          notifySuccess();
          navigate(`/notes/${created.id}`);
        }}
        onTag={openTag}
        onOpenMessage={openMessage}
      />

      {menu && (
        <Sheet title={title.trim() || 'Заметка'} onClose={() => setMenu(false)}>
          <div className="stack">
            <button
              className="btn btn--ghost btn--block"
              onClick={() => {
                setMenu(false);
                setGuide(true);
              }}
            >
              Как это работает
            </button>
            {note && (
              <button
                className="btn btn--danger btn--block"
                onClick={() => {
                  setMenu(false);
                  setConfirmDelete(true);
                }}
              >
                Удалить заметку
              </button>
            )}
          </div>
        </Sheet>
      )}

      {guide && <NotesGuide onClose={() => setGuide(false)} />}

      {linksSheet && (
        <Sheet title="Связи заметки" onClose={() => setLinksSheet(false)}>
          <p className="links-lead">
            Объединяйте мысли по смыслу — связанные заметки видно здесь и в графе.
          </p>
          {currentId.current && (
            <button
              className="btn btn--primary btn--block"
              onClick={() => {
                setLinksSheet(false);
                setLinkPick(true);
              }}
            >
              <IconLink size={16} /> Связать с заметкой
            </button>
          )}
          {relations.outgoing.length > 0 && (
            <LinksGroup
              title="Связанные мысли"
              items={relations.outgoing.map((n) => ({
                key: n.id,
                label: n.title,
                onClick: () => {
                  setLinksSheet(false);
                  navigate(`/notes/${n.id}`);
                },
              }))}
            />
          )}
          {relations.backlinks.length > 0 && (
            <LinksGroup
              title="Упоминают эту"
              items={relations.backlinks.map((n) => ({
                key: n.id,
                label: n.title,
                onClick: () => {
                  setLinksSheet(false);
                  navigate(`/notes/${n.id}`);
                },
              }))}
            />
          )}
          {relations.missing.length > 0 && (
            <LinksGroup
              title="Ещё не созданы"
              items={relations.missing.map((t) => ({
                key: t,
                label: `+ ${t}`,
                isNew: true,
                onClick: () => {
                  const created = useFinanceStore
                    .getState()
                    .addNote({ title: t, body: '', listId });
                  notifySuccess();
                  setLinksSheet(false);
                  navigate(`/notes/${created.id}`);
                },
              }))}
            />
          )}

          <div className="links-group">
            <div className="links-group__title">Люди</div>
            <div className="links-group__chips">
              {linkedPeople.map((p) => (
                <span key={p.id} className="note-chip note-chip--person note-chip--detach">
                  <button
                    className="note-chip__open"
                    onClick={() => {
                      setLinksSheet(false);
                      navigate(`/people/${p.id}`);
                    }}
                  >
                    <IconHeart size={13} /> {p.name}
                  </button>
                  <button
                    className="note-chip__detach"
                    onClick={() => detachPerson(p.id)}
                    aria-label="Отвязать"
                  >
                    ×
                  </button>
                </span>
              ))}
              {people.length > 0 && currentId.current && (
                <button
                  className="note-chip note-chip--new"
                  onClick={() => {
                    setLinksSheet(false);
                    setPeopleSheet(true);
                  }}
                >
                  + связать
                </button>
              )}
              {!linkedPeople.length && !people.length && (
                <span className="links-group__empty">Людей пока нет</span>
              )}
            </div>
          </div>

          {note && (
            <button
              className="btn btn--ghost btn--block"
              onClick={() => {
                setLinksSheet(false);
                navigate(`/notes/graph?focus=${note.id}`);
              }}
            >
              <IconGraph size={16} /> Граф вокруг заметки
            </button>
          )}
        </Sheet>
      )}

      {listSheet && (
        <Sheet title="Список заметки" onClose={() => setListSheet(false)}>
          <div className="sheet-list">
            <button
              className="flow-row"
              onClick={() => {
                pickList(undefined);
                setListSheet(false);
              }}
            >
              <span className="flow-row__name">Без списка</span>
              {!listId && <span className="flow-row__amount">✓</span>}
            </button>
            {noteLists.map((l) => (
              <button
                key={l.id}
                className="flow-row"
                onClick={() => {
                  pickList(l.id);
                  setListSheet(false);
                }}
              >
                <span className="flow-row__name">
                  {l.emoji ? `${l.emoji} ` : ''}
                  {l.name}
                </span>
                {listId === l.id && <span className="flow-row__amount">✓</span>}
              </button>
            ))}
          </div>
          {newListOpen ? (
            <div className="newlist-inline">
              <input
                className="input"
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createListHere()}
                placeholder="Название списка"
                autoFocus
              />
              <button
                className="btn btn--primary"
                disabled={!newListName.trim()}
                onClick={createListHere}
              >
                Создать
              </button>
            </div>
          ) : (
            <button
              className="btn btn--primary btn--block"
              style={{ marginTop: 10 }}
              onClick={() => setNewListOpen(true)}
            >
              ＋ Новый список
            </button>
          )}
          <button
            className="btn btn--ghost btn--block"
            style={{ marginTop: 10 }}
            onClick={() => {
              setListSheet(false);
              navigate('/notes/lists');
            }}
          >
            Управление списками
          </button>
        </Sheet>
      )}

      {linkPick && currentId.current && (
        <NotePicker
          notes={notes}
          excludeId={currentId.current}
          onClose={() => setLinkPick(false)}
          onPick={(n) => {
            if (currentId.current) addNoteMessage(currentId.current, `[[${n.title}]]`, []);
            notifySuccess();
            setLinkPick(false);
          }}
        />
      )}

      {peopleSheet && currentId.current && (
        <Sheet title="Связать и отвязать людей" onClose={() => setPeopleSheet(false)}>
          <div className="sheet-list">
            {people.map((person) => {
              const linked = personNoteLinks.some(
                (l) => l.noteId === currentId.current && l.personId === person.id,
              );
              return (
                <button
                  key={person.id}
                  className={`flow-row${linked ? ' is-linked' : ''}`}
                  onClick={() => {
                    if (!currentId.current) return;
                    if (linked) unlinkNoteFromPerson(person.id, currentId.current);
                    else linkNoteToPerson(person.id, currentId.current);
                    selectionChanged();
                  }}
                >
                  <span className="flow-row__name">
                    {linked ? '💛 ' : ''}
                    {person.name}
                  </span>
                  <span className={`note-link-toggle${linked ? ' is-on' : ''}`}>
                    {linked ? 'Отвязать' : 'Связать'}
                  </span>
                </button>
              );
            })}
          </div>
        </Sheet>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Удалить заметку?"
          message={`«${title.trim() || 'Без названия'}» исчезнет из базы.`}
          onClose={() => setConfirmDelete(false)}
          onConfirm={deleteNote}
        />
      )}
    </div>
  );
}

function LinksGroup({
  title,
  items,
}: {
  title: string;
  items: { key: string; label: string; isNew?: boolean; onClick: () => void }[];
}) {
  return (
    <div className="links-group">
      <div className="links-group__title">{title}</div>
      <div className="links-group__chips">
        {items.map((it) => (
          <button
            key={it.key}
            className={`note-chip${it.isNew ? ' note-chip--new' : ''}`}
            onClick={it.onClick}
          >
            {it.label}
          </button>
        ))}
      </div>
    </div>
  );
}
