import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Screen } from '@/components/ui';
import { useFinanceStore, type CollectionDraft } from '@/store';
import { notifySuccess, selectionChanged } from '@/lib/haptics';

const EMOJIS = ['🗂', '💼', '❤️', '☀️', '🌙', '🖤', '✈️', '👔', '🏖', '🎩', '🔥', '🧊'];

export function CollectionFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const existing = useFinanceStore((s) => (id ? s.getCollection(id) : undefined));
  const addCollection = useFinanceStore((s) => s.addCollection);
  const updateCollection = useFinanceStore((s) => s.updateCollection);

  const [name, setName] = useState(existing?.name ?? '');
  const [emoji, setEmoji] = useState(existing?.emoji ?? '🗂');

  const valid = name.trim().length > 0;
  const submit = () => {
    if (!valid) return;
    if (existing) {
      updateCollection(existing.id, { name: name.trim(), emoji });
      notifySuccess();
      navigate(-1);
    } else {
      const draft: CollectionDraft = { name: name.trim(), emoji, itemIds: [] };
      const created = addCollection(draft);
      notifySuccess();
      navigate(`/clothing/collections/${created.id}`, { replace: true });
    }
  };

  return (
    <Screen title={existing ? 'Изменить подборку' : 'Новая подборка'}>
      <div className="field">
        <label className="field__label">Название</label>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Напр. Для работы"
          autoFocus={!id}
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
        {existing ? 'Сохранить' : 'Создать подборку'}
      </button>
    </Screen>
  );
}
