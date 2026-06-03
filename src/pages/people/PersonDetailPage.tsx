import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { ConfirmDialog, Screen, Sheet, StatRow } from '@/components/ui';
import { IconCheck, IconGraph, IconHeart, IconNotes, IconPencil, IconPlus, IconTrash } from '@/components/icons';
import { useFinanceStore } from '@/store';
import type {
  ConversationImportance,
  ConversationMood,
  GiftStatus,
  MeetIdeaStatus,
  Person,
  PersonPromiseStatus,
  PersonRelationType,
  PreferenceType,
} from '@/types';
import { todayISO } from '@/lib/date';
import { formatDate, formatRUB, relativeDay } from '@/lib/format';
import { attachmentHref } from '@/lib/images';
import {
  CLOSENESS_LABEL,
  PREFERENCE_LABEL,
  PREFERENCE_TYPES,
  RELATION_LABEL,
  defaultReminderDate,
  nextBirthday,
  personCategoryEmoji,
  personCategoryLabel,
  personInitials,
} from '@/lib/people';
import { notifySuccess, notifyWarning, tapLight } from '@/lib/haptics';

type SheetKind = 'preference' | 'gift' | 'conversation' | 'promise' | 'meet' | 'relation' | 'note';

const GIFT_STATUS: Record<GiftStatus, string> = {
  idea: 'идея',
  bought: 'куплено',
  given: 'подарено',
};
const PROMISE_STATUS: Record<PersonPromiseStatus, string> = {
  open: 'активно',
  done: 'сделано',
  cancelled: 'отменено',
};
const MEET_STATUS: Record<MeetIdeaStatus, string> = {
  idea: 'идея',
  planned: 'запланировано',
  done: 'было',
};

export function PersonDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const person = useFinanceStore((s) => (id ? s.getPerson(id) : undefined));
  const people = useFinanceStore((s) => s.people);
  const notes = useFinanceStore((s) => s.notes);
  const preferences = useFinanceStore((s) => s.preferences);
  const gifts = useFinanceStore((s) => s.gifts);
  const conversations = useFinanceStore((s) => s.conversations);
  const promises = useFinanceStore((s) => s.promises);
  const meetIdeas = useFinanceStore((s) => s.meetIdeas);
  const relations = useFinanceStore((s) => s.personRelations);
  const noteLinks = useFinanceStore((s) => s.personNoteLinks);
  const addNote = useFinanceStore((s) => s.addNote);
  const linkNoteToPerson = useFinanceStore((s) => s.linkNoteToPerson);
  const removePerson = useFinanceStore((s) => s.removePerson);
  const removePreference = useFinanceStore((s) => s.removePreference);
  const removeGift = useFinanceStore((s) => s.removeGift);
  const removeConversation = useFinanceStore((s) => s.removeConversation);
  const updatePromise = useFinanceStore((s) => s.updatePromise);
  const removePromise = useFinanceStore((s) => s.removePromise);
  const updateMeetIdea = useFinanceStore((s) => s.updateMeetIdea);
  const removeMeetIdea = useFinanceStore((s) => s.removeMeetIdea);
  const removePersonRelation = useFinanceStore((s) => s.removePersonRelation);
  const unlinkNoteFromPerson = useFinanceStore((s) => s.unlinkNoteFromPerson);
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const personPrefs = useMemo(() => preferences.filter((item) => item.personId === id), [id, preferences]);
  const personGifts = useMemo(() => gifts.filter((item) => item.personId === id), [gifts, id]);
  const personConversations = useMemo(
    () => conversations.filter((item) => item.personId === id).sort((a, b) => b.date.localeCompare(a.date)),
    [conversations, id],
  );
  const personPromises = useMemo(() => promises.filter((item) => item.personId === id), [id, promises]);
  const personMeetIdeas = useMemo(() => meetIdeas.filter((item) => item.personId === id), [id, meetIdeas]);
  const personRelations = useMemo(
    () => relations.filter((item) => item.fromPersonId === id || item.toPersonId === id),
    [id, relations],
  );
  const linkedNotes = useMemo(() => {
    const ids = new Set(noteLinks.filter((link) => link.personId === id).map((link) => link.noteId));
    return notes.filter((note) => ids.has(note.id));
  }, [id, noteLinks, notes]);

  if (!person || !id) return <Navigate to="/people" replace />;

  const birthday = nextBirthday(person);
  const otherPeople = people.filter((item) => item.id !== person.id);

  const go = (path: string) => {
    tapLight();
    navigate(path);
  };

  const createLinkedNote = () => {
    const created = addNote({
      title: `${person.name}: заметка`,
      body: `Связано с ${person.name}`,
      attachments: [],
    });
    linkNoteToPerson(person.id, created.id);
    notifySuccess();
    navigate(`/notes/${created.id}`);
  };

  return (
    <Screen
      title={person.name}
      subtitle={`${personCategoryLabel(person)} · ${CLOSENESS_LABEL[person.closeness]}`}
      action={
        <div className="row">
          <button className="icon-round" onClick={() => go(`/people/${person.id}/edit`)} aria-label="Изменить">
            <IconPencil size={19} />
          </button>
          <button className="icon-round people-danger-round" onClick={() => setConfirmDelete(true)} aria-label="Удалить">
            <IconTrash size={19} />
          </button>
        </div>
      }
    >
      <div className="stack people-detail">
        <div className="person-hero card">
          <div className="person-hero__avatar">
            {person.avatar ? <img src={attachmentHref(person.avatar)} alt="" /> : <span>{personInitials(person.name)}</span>}
          </div>
          <div className="person-hero__body">
            <div className="person-hero__title">
              {person.favorite && <IconHeart size={18} />}
              <span>{personCategoryEmoji(person)} {personCategoryLabel(person)}</span>
            </div>
            <div className="person-hero__sub">
              {birthday ? `День рождения ${relativeDay(birthday.date)}` : 'День рождения можно добавить'}
            </div>
            {person.city && <div className="person-hero__sub">{person.city}</div>}
          </div>
        </div>

        <div className="people-actions-grid">
          <QuickButton label="Подарок" onClick={() => setSheet('gift')} />
          <QuickButton label="Разговор" onClick={() => setSheet('conversation')} />
          <QuickButton label="Обещание" onClick={() => setSheet('promise')} />
          <QuickButton label="Встреча" onClick={() => setSheet('meet')} />
        </div>

        <DetailSection
          title="Главное"
          action={
            <button className="people-edit-link" onClick={() => go(`/people/${person.id}/edit`)}>
              <IconPencil size={15} /> Изменить
            </button>
          }
        >
          <div className="card">
            <StatRow label="Кто это для меня" value={person.description || 'Можно дописать'} />
            {person.birthday && <StatRow label="День рождения" value={formatDate(person.birthday)} />}
            {person.phone && <StatRow label="Телефон" value={person.phone} />}
            {person.socials && <StatRow label="Telegram / соцсети" value={person.socials} />}
            {person.city && <StatRow label="Город" value={person.city} />}
            {person.tags.length > 0 && (
              <div className="people-chip-row">
                {person.tags.map((tag) => <span key={tag} className="note-chip">#{tag}</span>)}
              </div>
            )}
          </div>
        </DetailSection>

        <DetailSection title="Что любит" action={<AddTiny onClick={() => setSheet('preference')} />}>
          {personPrefs.length ? (
            <div className="people-chip-row">
              {personPrefs.map((item) => (
                <span key={item.id} className={`people-pref people-pref--${item.type}`}>
                  <b>{PREFERENCE_LABEL[item.type]}</b>
                  {item.value}
                  <button onClick={() => removePreference(item.id)} aria-label="Убрать">×</button>
                </span>
              ))}
            </div>
          ) : <SoftEmpty text="Любимая еда, музыка, места и то, что лучше не дарить." />}
        </DetailSection>

        <DetailSection title="Подарки" action={<AddTiny onClick={() => setSheet('gift')} />}>
          {personGifts.length ? (
            <div className="stack">
              {personGifts.map((gift) => (
                <MiniCard
                  key={gift.id}
                  title={gift.title}
                  meta={`${GIFT_STATUS[gift.status]}${gift.date ? ` · ${formatDate(gift.date, true)}` : ''}${gift.price ? ` · ${formatRUB(gift.price)}` : ''}`}
                  note={gift.reaction || gift.note}
                  onDelete={() => removeGift(gift.id)}
                />
              ))}
            </div>
          ) : <SoftEmpty text="Идеи подарков, что уже дарили и какая была реакция." />}
        </DetailSection>

        <DetailSection title="Важные разговоры" action={<AddTiny onClick={() => setSheet('conversation')} />}>
          {personConversations.length ? (
            <div className="stack">
              {personConversations.map((conversation) => (
                <MiniCard
                  key={conversation.id}
                  title={conversation.title}
                  meta={`${formatDate(conversation.date, true)} · ${conversation.importance === 'high' ? 'важно' : conversation.importance === 'low' ? 'легко' : 'обычно'}`}
                  note={conversation.note}
                  onDelete={() => removeConversation(conversation.id)}
                />
              ))}
            </div>
          ) : <SoftEmpty text="Короткий журнал: темы, настроение, что важно не забыть." />}
        </DetailSection>

        <DetailSection title="Обещания и напоминания" action={<AddTiny onClick={() => setSheet('promise')} />}>
          {personPromises.length ? (
            <div className="stack">
              {personPromises.map((promise) => (
                <MiniCard
                  key={promise.id}
                  title={promise.title}
                  meta={`${PROMISE_STATUS[promise.status]}${promise.dueDate ? ` · ${relativeDay(promise.dueDate)}` : ''}${promise.reminderDate ? ` · напомнить ${relativeDay(promise.reminderDate)}` : ''}`}
                  note={promise.note}
                  onDone={promise.status === 'open' ? () => updatePromise(promise.id, { status: 'done' }) : undefined}
                  onDelete={() => removePromise(promise.id)}
                />
              ))}
            </div>
          ) : <SoftEmpty text="Скинуть ссылку, спросить как врач, поздравить вовремя." />}
        </DetailSection>

        <DetailSection title="Идеи встреч" action={<AddTiny onClick={() => setSheet('meet')} />}>
          {personMeetIdeas.length ? (
            <div className="stack">
              {personMeetIdeas.map((meet) => (
                <MiniCard
                  key={meet.id}
                  title={meet.title}
                  meta={`${MEET_STATUS[meet.status]}${meet.date ? ` · ${formatDate(meet.date, true)}` : ''}`}
                  note={meet.note}
                  onDone={meet.status !== 'done' ? () => updateMeetIdea(meet.id, { status: 'done' }) : undefined}
                  onDelete={() => removeMeetIdea(meet.id)}
                />
              ))}
            </div>
          ) : <SoftEmpty text="Куда сходить, что сделать вместе и как прошло." />}
        </DetailSection>

        <DetailSection title="Заметки" action={<AddTiny onClick={() => setSheet('note')} />}>
          <div className="people-note-actions">
            <button className="btn btn--ghost" onClick={createLinkedNote}>
              <IconNotes size={18} /> Создать заметку
            </button>
            <button className="btn btn--ghost" onClick={() => setSheet('note')}>
              <IconPlus size={18} /> Связать
            </button>
          </div>
          {linkedNotes.length ? (
            <div className="stack">
              {linkedNotes.map((note) => (
                <div key={note.id} className="people-linked-note">
                  <button onClick={() => go(`/notes/${note.id}`)}>
                    <IconPencil size={16} />
                    <span>
                      <b>{note.title}</b>
                      <small>Открыть и редактировать заметку</small>
                    </span>
                  </button>
                  <button onClick={() => unlinkNoteFromPerson(person.id, note.id)} aria-label="Отвязать">
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : <SoftEmpty text="Можно привязать обычные заметки Coco к этому человеку." />}
        </DetailSection>

        <DetailSection title="Связи между людьми" action={<AddTiny onClick={() => setSheet('relation')} />}>
          {personRelations.length ? (
            <div className="people-chip-row">
              {personRelations.map((relation) => {
                const otherId = relation.fromPersonId === person.id ? relation.toPersonId : relation.fromPersonId;
                const other = people.find((item) => item.id === otherId);
                if (!other) return null;
                return (
                  <button key={relation.id} className="note-chip" onClick={() => go(`/people/${other.id}`)}>
                    {other.name} · {RELATION_LABEL[relation.relationType]}
                    <span onClick={(e) => { e.stopPropagation(); removePersonRelation(relation.id); }}>×</span>
                  </button>
                );
              })}
            </div>
          ) : <SoftEmpty text="Например: коллега, пара, родственник, знакомый." />}
        </DetailSection>

        <button className="people-graph-link" onClick={() => go(`/notes/graph?person=${person.id}`)}>
          <span className="people-graph-link__icon">
            <IconGraph />
          </span>
          <span>
            <b>Локальный граф связей</b>
            <small>Человек, заметки, подарки, обещания, события и теги</small>
          </span>
        </button>
      </div>

      {sheet && (
        <PersonActionSheet
          kind={sheet}
          person={person}
          people={otherPeople}
          notes={notes}
          linkedNoteIds={new Set(linkedNotes.map((note) => note.id))}
          onClose={() => setSheet(null)}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Удалить человека?"
          message={`«${person.name}» и все связанные записи в разделе Люди исчезнут.`}
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => {
            removePerson(person.id);
            notifyWarning();
            navigate('/people', { replace: true });
          }}
        />
      )}
    </Screen>
  );
}

function QuickButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="people-quick" onClick={onClick}>
      <IconPlus size={17} />
      {label}
    </button>
  );
}

function AddTiny({ onClick }: { onClick: () => void }) {
  return (
    <button className="people-add-tiny" onClick={onClick} aria-label="Добавить">
      <IconPlus size={16} />
    </button>
  );
}

function DetailSection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="people-block">
      <div className="people-block__head">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function SoftEmpty({ text }: { text: string }) {
  return <div className="people-soft-empty">{text}</div>;
}

function MiniCard({
  title,
  meta,
  note,
  onDone,
  onDelete,
}: {
  title: string;
  meta?: string;
  note?: string;
  onDone?: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="people-mini">
      <div className="people-mini__body">
        <b>{title}</b>
        {meta && <small>{meta}</small>}
        {note && <p>{note}</p>}
      </div>
      {onDone && (
        <button className="icon-btn" onClick={onDone} aria-label="Сделано">
          <IconCheck size={17} />
        </button>
      )}
      <button className="icon-btn" onClick={onDelete} aria-label="Удалить">
        <IconTrash size={17} />
      </button>
    </div>
  );
}

function PersonActionSheet({
  kind,
  person,
  people,
  notes,
  linkedNoteIds,
  onClose,
}: {
  kind: SheetKind;
  person: Person;
  people: Person[];
  notes: { id: string; title: string }[];
  linkedNoteIds: Set<string>;
  onClose: () => void;
}) {
  const addPreference = useFinanceStore((s) => s.addPreference);
  const addGift = useFinanceStore((s) => s.addGift);
  const addConversation = useFinanceStore((s) => s.addConversation);
  const addPromise = useFinanceStore((s) => s.addPromise);
  const addMeetIdea = useFinanceStore((s) => s.addMeetIdea);
  const addPersonRelation = useFinanceStore((s) => s.addPersonRelation);
  const linkNoteToPerson = useFinanceStore((s) => s.linkNoteToPerson);

  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(kind === 'conversation' ? todayISO() : '');
  const [status, setStatus] = useState('idea');
  const [price, setPrice] = useState('');
  const [reaction, setReaction] = useState('');
  const [prefType, setPrefType] = useState<PreferenceType>('food');
  const [importance, setImportance] = useState<ConversationImportance>('normal');
  const [mood, setMood] = useState<ConversationMood>('warm');
  const [promiseStatus, setPromiseStatus] = useState<PersonPromiseStatus>('open');
  const [reminderDate, setReminderDate] = useState('');
  const [relationType, setRelationType] = useState<PersonRelationType>('friend');
  const [targetPersonId, setTargetPersonId] = useState(people[0]?.id ?? '');
  const [targetNoteId, setTargetNoteId] = useState(notes.find((item) => !linkedNoteIds.has(item.id))?.id ?? '');

  const closeSuccess = () => {
    notifySuccess();
    onClose();
  };

  const save = () => {
    const cleanTitle = title.trim();
    if ((kind !== 'relation' && kind !== 'note') && !cleanTitle) {
      notifyWarning();
      return;
    }
    if (kind === 'preference') {
      addPreference({ personId: person.id, type: prefType, value: cleanTitle, note: note.trim() || undefined });
    }
    if (kind === 'gift') {
      addGift({
        personId: person.id,
        title: cleanTitle,
        status: status as GiftStatus,
        price: price ? Number(price) : undefined,
        date: date || undefined,
        reaction: reaction.trim() || undefined,
        note: note.trim() || undefined,
      });
    }
    if (kind === 'conversation') {
      addConversation({
        personId: person.id,
        date: date || todayISO(),
        title: cleanTitle,
        note: note.trim() || undefined,
        importance,
        mood,
      });
    }
    if (kind === 'promise') {
      addPromise({
        personId: person.id,
        title: cleanTitle,
        dueDate: date || undefined,
        reminderDate: reminderDate || (date ? defaultReminderDate(date) : undefined),
        status: promiseStatus,
        note: note.trim() || undefined,
      });
    }
    if (kind === 'meet') {
      addMeetIdea({
        personId: person.id,
        title: cleanTitle,
        status: status as MeetIdeaStatus,
        date: date || undefined,
        note: note.trim() || undefined,
      });
    }
    if (kind === 'relation') {
      if (!targetPersonId) {
        notifyWarning();
        return;
      }
      addPersonRelation({
        fromPersonId: person.id,
        toPersonId: targetPersonId,
        relationType,
        note: note.trim() || undefined,
      });
    }
    if (kind === 'note') {
      if (!targetNoteId) {
        notifyWarning();
        return;
      }
      linkNoteToPerson(person.id, targetNoteId);
    }
    closeSuccess();
  };

  const titleByKind: Record<SheetKind, string> = {
    preference: 'Что любит',
    gift: 'Подарок',
    conversation: 'Разговор',
    promise: 'Обещание',
    meet: 'Идея встречи',
    relation: 'Связь с человеком',
    note: 'Связать заметку',
  };

  return (
    <Sheet title={titleByKind[kind]} onClose={onClose}>
      <div className="stack">
        {kind === 'preference' && (
          <>
            <select className="select" value={prefType} onChange={(e) => setPrefType(e.target.value as PreferenceType)}>
              {PREFERENCE_TYPES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Напр. раф без сахара" autoFocus />
          </>
        )}

        {kind === 'gift' && (
          <>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Идея подарка" autoFocus />
            <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="idea">Идея</option>
              <option value="bought">Куплено</option>
              <option value="given">Подарено</option>
            </select>
            <input className="input" type="number" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Цена" />
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <input className="input" value={reaction} onChange={(e) => setReaction(e.target.value)} placeholder="Реакция" />
          </>
        )}

        {kind === 'conversation' && (
          <>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Тема разговора" autoFocus />
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <select className="select" value={importance} onChange={(e) => setImportance(e.target.value as ConversationImportance)}>
              <option value="normal">Обычная важность</option>
              <option value="high">Важно</option>
              <option value="low">Лёгкое</option>
            </select>
            <select className="select" value={mood} onChange={(e) => setMood(e.target.value as ConversationMood)}>
              <option value="warm">Тёплое настроение</option>
              <option value="happy">Радостно</option>
              <option value="neutral">Нейтрально</option>
              <option value="hard">Тяжело</option>
            </select>
          </>
        )}

        {kind === 'promise' && (
          <>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Что я пообещал" autoFocus />
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <input className="input" type="date" value={reminderDate} onChange={(e) => setReminderDate(e.target.value)} />
            <select className="select" value={promiseStatus} onChange={(e) => setPromiseStatus(e.target.value as PersonPromiseStatus)}>
              <option value="open">Активно</option>
              <option value="done">Сделано</option>
              <option value="cancelled">Отменено</option>
            </select>
          </>
        )}

        {kind === 'meet' && (
          <>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Куда сходить / что сделать" autoFocus />
            <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="idea">Идея</option>
              <option value="planned">Запланировано</option>
              <option value="done">Было</option>
            </select>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </>
        )}

        {kind === 'relation' && (
          <>
            {people.length ? (
              <>
                <select className="select" value={targetPersonId} onChange={(e) => setTargetPersonId(e.target.value)}>
                  {people.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <select className="select" value={relationType} onChange={(e) => setRelationType(e.target.value as PersonRelationType)}>
                  <option value="friend">Друг</option>
                  <option value="relative">Родственник</option>
                  <option value="colleague">Коллега</option>
                  <option value="acquaintance">Знакомый</option>
                  <option value="couple">Пара</option>
                  <option value="other">Другое</option>
                </select>
              </>
            ) : (
              <SoftEmpty text="Сначала добавьте ещё одного человека." />
            )}
          </>
        )}

        {kind === 'note' && (
          <>
            {notes.length ? (
              <select className="select" value={targetNoteId} onChange={(e) => setTargetNoteId(e.target.value)}>
                {notes.map((item) => (
                  <option key={item.id} value={item.id} disabled={linkedNoteIds.has(item.id)}>
                    {linkedNoteIds.has(item.id) ? '✓ ' : ''}{item.title}
                  </option>
                ))}
              </select>
            ) : (
              <SoftEmpty text="Заметок пока нет. Создайте новую из карточки человека." />
            )}
          </>
        )}

        {kind !== 'note' && (
          <textarea
            className="input people-textarea"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={kind === 'relation' ? 'Заметка о связи' : 'Заметка'}
            rows={3}
          />
        )}

        <button className="btn btn--primary btn--block" onClick={save}>
          Сохранить
        </button>
      </div>
    </Sheet>
  );
}
