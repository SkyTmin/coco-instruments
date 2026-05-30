import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Screen } from '@/components/ui';
import { useFinanceStore, type ListDraft } from '@/store';
import { notifySuccess, selectionChanged } from '@/lib/haptics';

const EMOJIS = ['📂', '💍', '🏠', '🚗', '🎁', '✈️', '🎓', '🛋️', '🔧', '🎉', '👶', '💻'];

export function ListFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const existing = useFinanceStore((s) => (id ? s.getList(id) : undefined));
  const addList = useFinanceStore((s) => s.addList);
  const updateList = useFinanceStore((s) => s.updateList);

  const [name, setName] = useState(existing?.name ?? '');
  const [emoji, setEmoji] = useState(existing?.emoji ?? '📂');

  const valid = name.trim().length > 0;
  const submit = () => {
    if (!valid) return;
    const draft: ListDraft = { name: name.trim(), emoji };
    if (existing) updateList(existing.id, draft);
    else addList(draft);
    notifySuccess();
    navigate(-1);
  };

  return (
    <Screen title={existing ? 'Изменить список' : 'Новый список'}>
      <div className="field">
        <label className="field__label">Название</label>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Напр. Свадьба"
        />
      </div>

      <div className="field">
        <label className="field__label">Иконка</label>
        <div className="emoji-grid">
          {EMOJIS.map((e) => (
            <button
              key={e}
              className={`emoji-opt${emoji === e ? ' is-active' : ''}`}
              onClick={() => {
                selectionChanged();
                setEmoji(e);
              }}
            >
              {e}
            </button>
          ))}
        </div>
      </div>

      <button className="btn btn--primary btn--block" disabled={!valid} onClick={submit}>
        {existing ? 'Сохранить' : 'Создать список'}
      </button>
    </Screen>
  );
}
