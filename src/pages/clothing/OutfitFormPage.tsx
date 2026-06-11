import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Screen } from '@/components/ui';
import { PhotoPicker } from '@/components/PhotoPicker';
import { useFinanceStore } from '@/store';
import type { Attachment } from '@/types';
import { notifySuccess } from '@/lib/haptics';

export function OutfitFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const existing = useFinanceStore((s) => (id ? s.getOutfit(id) : undefined));
  const addOutfit = useFinanceStore((s) => s.addOutfit);
  const updateOutfit = useFinanceStore((s) => s.updateOutfit);

  const [cover, setCover] = useState<Attachment | undefined>(existing?.cover);
  const [name, setName] = useState(existing?.name ?? '');
  const [note, setNote] = useState(existing?.note ?? '');

  const valid = name.trim().length > 0;
  const submit = () => {
    if (!valid) return;
    if (existing) {
      updateOutfit(existing.id, { name: name.trim(), cover, note: note.trim() || undefined });
      notifySuccess();
      navigate(-1);
    } else {
      const created = addOutfit({
        name: name.trim(),
        cover,
        itemIds: [],
        note: note.trim() || undefined,
      });
      notifySuccess();
      navigate(`/clothing/outfits/${created.id}`, { replace: true });
    }
  };

  return (
    <Screen title={existing ? 'Изменить образ' : 'Новый образ'}>
      <PhotoPicker photo={cover} onChange={setCover} label="Фото образа (обложка)" />

      <div className="field">
        <label className="field__label">Название</label>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Напр. На встречу"
          autoFocus={!id}
        />
      </div>
      <div className="field">
        <label className="field__label">Заметка (необяз.)</label>
        <input
          className="input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Когда / куда"
        />
      </div>

      <button className="btn btn--primary btn--block" disabled={!valid} onClick={submit}>
        {existing ? 'Сохранить' : 'Создать образ'}
      </button>
    </Screen>
  );
}
