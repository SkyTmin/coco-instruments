import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ConfirmDialog, Screen } from '@/components/ui';
import { PhotoPicker } from '@/components/PhotoPicker';
import { useFinanceStore, type WishDraft } from '@/store';
import type { Attachment } from '@/types';
import { notifySuccess, notifyWarning } from '@/lib/haptics';

export function WishFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const existing = useFinanceStore((s) => (id ? s.getWish(id) : undefined));
  const addWish = useFinanceStore((s) => s.addWish);
  const updateWish = useFinanceStore((s) => s.updateWish);
  const removeWish = useFinanceStore((s) => s.removeWish);

  const [photo, setPhoto] = useState<Attachment | undefined>(existing?.photo);
  const [name, setName] = useState(existing?.name ?? '');
  const [price, setPrice] = useState(existing?.price ? String(existing.price) : '');
  const [link, setLink] = useState(existing?.link ?? '');
  const [note, setNote] = useState(existing?.note ?? '');
  const [confirm, setConfirm] = useState(false);

  const valid = name.trim().length > 0;
  const submit = () => {
    if (!valid) return;
    const p = parseFloat(price.replace(',', '.'));
    const draft: WishDraft = {
      name: name.trim(),
      photo,
      price: Number.isFinite(p) && p > 0 ? p : undefined,
      link: link.trim() || undefined,
      note: note.trim() || undefined,
    };
    if (existing) updateWish(existing.id, draft);
    else addWish(draft);
    notifySuccess();
    navigate(-1);
  };

  return (
    <Screen title={existing ? 'Изменить' : 'Новая вещь'}>
      <PhotoPicker photo={photo} onChange={setPhoto} label="Фото (необяз.)" />

      <div className="field">
        <label className="field__label">Название</label>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Что хотите купить"
          autoFocus={!id}
        />
      </div>
      <div className="field">
        <label className="field__label">Цена (необяз.)</label>
        <input
          className="input"
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="₽"
        />
      </div>
      <div className="field">
        <label className="field__label">Ссылка (необяз.)</label>
        <input className="input" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" />
      </div>
      <div className="field">
        <label className="field__label">Заметка (необяз.)</label>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Цвет, размер…" />
      </div>

      <button className="btn btn--primary btn--block" disabled={!valid} onClick={submit}>
        {existing ? 'Сохранить' : 'Добавить'}
      </button>
      {existing && (
        <button className="btn btn--danger btn--block" style={{ marginTop: 12 }} onClick={() => setConfirm(true)}>
          Удалить
        </button>
      )}

      {confirm && existing && (
        <ConfirmDialog
          message={`Удалить «${name.trim() || 'вещь'}»?`}
          onConfirm={() => {
            removeWish(existing.id);
            notifyWarning();
            navigate('/clothing/wishlist', { replace: true });
          }}
          onClose={() => setConfirm(false)}
        />
      )}
    </Screen>
  );
}
