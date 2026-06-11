import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { EmptyState, Screen, SwipeRow } from '@/components/ui';
import { IconGraph, IconList, IconPencil, IconTrash } from '@/components/icons';
import { useFinanceStore } from '@/store';
import { notifySuccess, notifyWarning, selectionChanged, tapLight } from '@/lib/haptics';
import { NotesHelpButton } from '@/components/NotesGuide';

const LIST_EMOJIS = [
  '📋',
  '🏥',
  '💪',
  '💼',
  '🏠',
  '🎓',
  '✈️',
  '🍳',
  '🎬',
  '📚',
  '💡',
  '🌱',
  '💰',
  '❤️',
];

export function NoteListsPage() {
  const navigate = useNavigate();
  const noteLists = useFinanceStore((s) => s.noteLists);
  const notes = useFinanceStore((s) => s.notes);
  const addNoteList = useFinanceStore((s) => s.addNoteList);
  const updateNoteList = useFinanceStore((s) => s.updateNoteList);
  const removeNoteList = useFinanceStore((s) => s.removeNoteList);

  const [searchParams] = useSearchParams();
  // ?new=1 (the "create a list" promo) opens the form right away.
  const [open, setOpen] = useState(searchParams.get('new') === '1');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(LIST_EMOJIS[0]);

  const countOf = (listId: string) => notes.filter((n) => n.listId === listId).length;

  const closeForm = () => {
    setOpen(false);
    setEditingId(null);
    setName('');
    setEmoji(LIST_EMOJIS[0]);
  };
  const save = () => {
    if (!name.trim()) return;
    if (editingId) {
      updateNoteList(editingId, { name, emoji });
      notifySuccess();
      closeForm();
      return;
    }
    const list = addNoteList(name, emoji);
    notifySuccess();
    closeForm();
    navigate(`/notes/lists/${list.id}`);
  };
  const startEdit = (id: string, listName: string, listEmoji?: string) => {
    selectionChanged();
    setEditingId(id);
    setName(listName);
    setEmoji(listEmoji ?? LIST_EMOJIS[0]);
    setOpen(true);
  };

  const askDelete = (id: string, label: string) => {
    if (window.confirm(`Удалить список «${label}»? Заметки сохранятся и станут «без списка».`)) {
      notifyWarning();
      removeNoteList(id, false);
    }
  };

  return (
    <Screen
      title="Списки"
      subtitle={
        noteLists.length
          ? `${noteLists.length} ${listWord(noteLists.length)}`
          : 'Заметки по тетрадям'
      }
      action={<NotesHelpButton />}
    >
      <div className="stack notes-page">
        {open ? (
          <div className="card stack">
            <b>{editingId ? 'Изменить список' : 'Новый список'}</b>
            <div className="note-list-emoji">
              {LIST_EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  className={`note-list-emoji__btn${emoji === e ? ' is-active' : ''}`}
                  onClick={() => {
                    setEmoji(e);
                    selectionChanged();
                  }}
                >
                  {e}
                </button>
              ))}
            </div>
            <input
              className="input"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Напр. Здоровье"
              onKeyDown={(e) => e.key === 'Enter' && save()}
            />
            <div className="row" style={{ gap: 10 }}>
              <button className="btn btn--ghost" style={{ flex: 1 }} onClick={closeForm}>
                Отмена
              </button>
              <button
                className="btn btn--primary"
                style={{ flex: 1 }}
                disabled={!name.trim()}
                onClick={save}
              >
                {editingId ? 'Сохранить' : 'Создать'}
              </button>
            </div>
          </div>
        ) : (
          <div className="notes-actions">
            <button
              className="notes-action notes-action--primary"
              onClick={() => {
                tapLight();
                setOpen(true);
              }}
            >
              <span className="notes-action__icon">
                <IconList />
              </span>
              <span>Новый список</span>
            </button>
            <button
              className="notes-action notes-action--graph"
              onClick={() => {
                tapLight();
                navigate('/notes/graph');
              }}
            >
              <span className="notes-action__icon">
                <IconGraph />
              </span>
              <span>Общий граф</span>
            </button>
          </div>
        )}

        <div className="stack">
          {noteLists.map((list, index) => (
            <SwipeRow
              key={list.id}
              onTap={() => {
                selectionChanged();
                navigate(`/notes/lists/${list.id}`);
              }}
              actions={[
                {
                  icon: <IconPencil size={20} />,
                  label: 'Изменить',
                  onClick: () => startEdit(list.id, list.name, list.emoji),
                },
                {
                  icon: <IconTrash size={20} />,
                  label: 'Удалить',
                  danger: true,
                  onClick: () => askDelete(list.id, list.name),
                },
              ]}
            >
              <div
                className="note-list-row"
                style={{ animationDelay: `${Math.min(index, 10) * 26}ms` }}
              >
                <span className="note-list-row__emoji">{list.emoji ?? '📋'}</span>
                <div className="note-list-row__main">
                  <div className="note-list-row__name">{list.name}</div>
                  <div className="note-list-row__sub">
                    {countOf(list.id)} {noteWord(countOf(list.id))}
                  </div>
                </div>
                <span className="note-list-row__chevron">›</span>
              </div>
            </SwipeRow>
          ))}
          {!noteLists.length && !open && (
            <EmptyState
              icon="📚"
              title="Списков пока нет"
              sub="Создайте первый — например «Здоровье»"
            />
          )}
        </div>
      </div>
    </Screen>
  );
}

function listWord(n: number): string {
  const a = n % 10;
  const b = n % 100;
  if (a === 1 && b !== 11) return 'список';
  if (a >= 2 && a <= 4 && (b < 10 || b >= 20)) return 'списка';
  return 'списков';
}
function noteWord(n: number): string {
  const a = n % 10;
  const b = n % 100;
  if (a === 1 && b !== 11) return 'заметка';
  if (a >= 2 && a <= 4 && (b < 10 || b >= 20)) return 'заметки';
  return 'заметок';
}
