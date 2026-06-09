import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ConfirmDialog, Sheet } from '@/components/ui';
import { ChatThread } from '@/components/ChatThread';
import { NotesHelpButton } from '@/components/NotesGuide';
import { IconGraph, IconHeart, IconTrash } from '@/components/icons';
import type { NoteAttachment } from '@/types';
import { useFinanceStore } from '@/store';
import { getNoteRelations } from '@/lib/notes-graph';
import { deriveFromMessages, makeMessage, materializeMessages } from '@/lib/notes-messages';
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
  const addNoteMessage = useFinanceStore((s) => s.addNoteMessage);
  const updateNoteMessage = useFinanceStore((s) => s.updateNoteMessage);
  const removeNoteMessage = useFinanceStore((s) => s.removeNoteMessage);
  const updateNote = useFinanceStore((s) => s.updateNote);
  const removeNote = useFinanceStore((s) => s.removeNote);
  const linkNoteToPerson = useFinanceStore((s) => s.linkNoteToPerson);
  const unlinkNoteFromPerson = useFinanceStore((s) => s.unlinkNoteFromPerson);

  const currentId = useRef<string | undefined>(id);
  currentId.current = id ?? currentId.current;
  const deleted = useRef(false);

  const [title, setTitle] = useState(note?.title ?? '');
  const [listId, setListId] = useState<string | undefined>(note?.listId ?? searchParams.get('list') ?? undefined);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [peopleSheet, setPeopleSheet] = useState(false);

  const loadedId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!note || note.id === loadedId.current) return;
    loadedId.current = note.id;
    setTitle(note.title);
    setListId(note.listId);
  }, [note]);

  const messages = useMemo(() => (note ? materializeMessages(note) : []), [note]);
  const relations = useMemo(() => getNoteRelations(note, notes), [note, notes]);
  const linkedPeople = useMemo(() => {
    const noteId = currentId.current;
    if (!noteId) return [];
    const ids = new Set(personNoteLinks.filter((l) => l.noteId === noteId).map((l) => l.personId));
    return people.filter((p) => ids.has(p.id));
  }, [people, personNoteLinks]);

  if (id && hydrated && !note && !deleted.current) return <Navigate to="/notes" replace />;

  const saveTitle = () => {
    const t = title.trim();
    if (currentId.current && t && t !== note?.title) updateNote(currentId.current, { title: t });
  };

  const ensureNote = (firstText: string, atts: NoteAttachment[]): string => {
    const msg = makeMessage(firstText, atts);
    const derived = deriveFromMessages([msg]);
    const t = title.trim() || firstText.split('\n')[0].trim().slice(0, 60) || 'Заметка';
    const created = addNote({ title: t, messages: [msg], body: derived.body, attachments: derived.attachments, listId });
    currentId.current = created.id;
    loadedId.current = created.id;
    if (!title.trim()) setTitle(t);
    navigate(`/notes/${created.id}`, { replace: true });
    return created.id;
  };

  const onSend = (text: string, atts: NoteAttachment[]) => {
    if (currentId.current) addNoteMessage(currentId.current, text, atts);
    else ensureNote(text, atts);
  };

  const pickList = (newListId: string | undefined) => {
    selectionChanged();
    setListId(newListId);
    if (currentId.current) updateNote(currentId.current, { listId: newListId });
  };

  const openPeopleSheet = () => {
    if (!currentId.current) return;
    tapLight();
    setPeopleSheet(true);
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

  const info = (
    <div className="chat-info">
      {noteLists.length > 0 && (
        <div className="note-list-pick">
          <button className={`note-list-pick__chip${!listId ? ' is-active' : ''}`} onClick={() => pickList(undefined)}>
            Без списка
          </button>
          {noteLists.map((l) => (
            <button
              key={l.id}
              className={`note-list-pick__chip${listId === l.id ? ' is-active' : ''}`}
              onClick={() => pickList(l.id)}
            >
              {l.emoji ? `${l.emoji} ` : ''}
              {l.name}
            </button>
          ))}
        </div>
      )}

      {(linkedPeople.length > 0 || (note && people.length > 0)) && (
        <div className="notes-relation-row">
          <span>Люди</span>
          <div>
            {linkedPeople.map((p) => (
              <span key={p.id} className="note-chip note-chip--person note-chip--detach">
                <button className="note-chip__open" onClick={() => navigate(`/people/${p.id}`)}>
                  <IconHeart size={13} /> {p.name}
                </button>
                <button className="note-chip__detach" onClick={() => detachPerson(p.id)} aria-label="Отвязать">
                  ×
                </button>
              </span>
            ))}
            {people.length > 0 && (
              <button className="note-chip note-chip--new" onClick={openPeopleSheet}>
                + связать
              </button>
            )}
          </div>
        </div>
      )}

      {note && relations.outgoing.length > 0 && (
        <div className="notes-relation-row">
          <span>Ссылки</span>
          <div>
            {relations.outgoing.map((n) => (
              <button key={n.id} className="note-chip" onClick={() => navigate(`/notes/${n.id}`)}>
                {n.title}
              </button>
            ))}
          </div>
        </div>
      )}
      {note && relations.backlinks.length > 0 && (
        <div className="notes-relation-row">
          <span>Обратные</span>
          <div>
            {relations.backlinks.map((n) => (
              <button key={n.id} className="note-chip" onClick={() => navigate(`/notes/${n.id}`)}>
                {n.title}
              </button>
            ))}
          </div>
        </div>
      )}
      {note && (
        <button className="btn btn--ghost btn--block note-graph-link" onClick={() => navigate(`/notes/graph?focus=${note.id}`)}>
          <IconGraph size={16} /> Граф вокруг заметки
        </button>
      )}
    </div>
  );

  return (
    <div className="chat-page">
      <div className="chat-head">
        <input
          className="chat-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          placeholder="Название заметки"
        />
        <div className="chat-head__actions">
          <NotesHelpButton />
          {note && (
            <button className="icon-btn" onClick={() => setConfirmDelete(true)} aria-label="Удалить">
              <IconTrash size={20} />
            </button>
          )}
        </div>
      </div>

      <ChatThread
        messages={messages}
        notes={notes}
        header={info}
        emptyHint="Это заметка-чат. Напишите сообщение, прикрепите фото — всё внизу."
        onSend={onSend}
        onEditMessage={(mid, text, atts) => currentId.current && updateNoteMessage(currentId.current, mid, text, atts)}
        onDeleteMessage={(mid) => currentId.current && removeNoteMessage(currentId.current, mid)}
        onOpenNote={(nid) => navigate(`/notes/${nid}`)}
        onOpenMissing={(t) => {
          const created = useFinanceStore.getState().addNote({ title: t, body: '', listId });
          notifySuccess();
          navigate(`/notes/${created.id}`);
        }}
        onTag={(t) => navigate(`/notes/tag/${encodeURIComponent(t)}`)}
      />

      {confirmDelete && (
        <ConfirmDialog
          title="Удалить заметку?"
          message={`«${title.trim() || 'Без названия'}» исчезнет из базы.`}
          onClose={() => setConfirmDelete(false)}
          onConfirm={deleteNote}
        />
      )}

      {peopleSheet && currentId.current && (
        <Sheet title="Связать и отвязать людей" onClose={() => setPeopleSheet(false)}>
          <div className="sheet-list">
            {people.map((person) => {
              const linked = personNoteLinks.some((l) => l.noteId === currentId.current && l.personId === person.id);
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
                  <span className={`note-link-toggle${linked ? ' is-on' : ''}`}>{linked ? 'Отвязать' : 'Связать'}</span>
                </button>
              );
            })}
          </div>
        </Sheet>
      )}
    </div>
  );
}
