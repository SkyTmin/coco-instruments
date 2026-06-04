import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ConfirmDialog, Screen } from '@/components/ui';
import { PhotoPicker } from '@/components/PhotoPicker';
import { useFinanceStore, type WishDraft } from '@/store';
import type { Attachment, WishStatus } from '@/types';
import { WISH_STATUSES } from '@/lib/clothing';
import { notifySuccess, notifyWarning } from '@/lib/haptics';

export function WishFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [params] = useSearchParams();
  const existing = useFinanceStore((s) => (id ? s.getWish(id) : undefined));
  const addWish = useFinanceStore((s) => s.addWish);
  const updateWish = useFinanceStore((s) => s.updateWish);
  const removeWish = useFinanceStore((s) => s.removeWish);

  // When opened as "чего не хватает для образа" the outfit is passed in the URL.
  const linkedOutfitId = existing?.outfitId ?? params.get('outfit') ?? undefined;
  const linkedOutfit = useFinanceStore((s) => (linkedOutfitId ? s.getOutfit(linkedOutfitId) : undefined));

  const [photo, setPhoto] = useState<Attachment | undefined>(existing?.photo);
  const [name, setName] = useState(existing?.name ?? '');
  const [price, setPrice] = useState(existing?.price ? String(existing.price) : '');
  const [link, setLink] = useState(existing?.link ?? '');
  const [note, setNote] = useState(existing?.note ?? '');
  const [status, setStatus] = useState<WishStatus>(existing?.status ?? 'want');
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
      status,
      outfitId: linkedOutfit ? linkedOutfit.id : undefined,
    };
    if (existing) updateWish(existing.id, draft);
    else addWish(draft);
    notifySuccess();
    navigate(-1);
  };

  return (
    <Screen title={existing ? 'Изменить' : 'Новая вещь'}>
      {linkedOutfit && (
        <div className="wish-linked">
          Не хватает для образа <b>«{linkedOutfit.name}»</b>
        </div>
      )}

      <PhotoPicker photo={photo} onChange={setPhoto} label="Фото (необяз.)" />

      <div className="field">
        <label className="field__label">Статус</label>
        <div className="chips">
          {WISH_STATUSES.map((s) => (
            <button
              key={s.id}
              className={`chip${status === s.id ? ' is-active' : ''}`}
              onClick={() => setStatus(s.id)}
            >
              {s.emoji} {s.label}
            </button>
          ))}
        </div>
      </div>

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
