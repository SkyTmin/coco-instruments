import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Screen } from '@/components/ui';
import { PhotoPicker } from '@/components/PhotoPicker';
import { CATEGORIES, SEASONS } from '@/lib/clothing';
import { useFinanceStore, type WardrobeItemDraft } from '@/store';
import type { Attachment, ClothingCategory, Season } from '@/types';
import { notifySuccess, selectionChanged } from '@/lib/haptics';

export function WardrobeItemFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const existing = useFinanceStore((s) => (id ? s.getItem(id) : undefined));
  const addItem = useFinanceStore((s) => s.addItem);
  const updateItem = useFinanceStore((s) => s.updateItem);

  const [photo, setPhoto] = useState<Attachment | undefined>(existing?.photo);
  const [name, setName] = useState(existing?.name ?? '');
  const [category, setCategory] = useState<ClothingCategory>(existing?.category ?? 'top');
  const [color, setColor] = useState(existing?.color ?? '');
  const [season, setSeason] = useState<Season | ''>(existing?.season ?? '');
  const [brand, setBrand] = useState(existing?.brand ?? '');
  const [size, setSize] = useState(existing?.size ?? '');
  const [price, setPrice] = useState(existing?.price ? String(existing.price) : '');
  const [note, setNote] = useState(existing?.note ?? '');

  const valid = name.trim().length > 0;
  const submit = () => {
    if (!valid) return;
    const p = parseFloat(price.replace(',', '.'));
    const draft: WardrobeItemDraft = {
      name: name.trim(),
      category,
      photo,
      color: color.trim() || undefined,
      season: season || undefined,
      brand: brand.trim() || undefined,
      size: size.trim() || undefined,
      price: Number.isFinite(p) && p > 0 ? p : undefined,
      note: note.trim() || undefined,
    };
    if (existing) updateItem(existing.id, draft);
    else addItem(draft);
    notifySuccess();
    navigate(-1);
  };

  return (
    <Screen title={existing ? 'Изменить вещь' : 'Новая вещь'}>
      <PhotoPicker photo={photo} onChange={setPhoto} />

      <div className="field">
        <label className="field__label">Название</label>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Напр. Белая рубашка"
          autoFocus={!id}
        />
      </div>

      <div className="field">
        <label className="field__label">Категория</label>
        <div className="chips">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`chip${category === c.id ? ' is-active' : ''}`}
              onClick={() => {
                selectionChanged();
                setCategory(c.id);
              }}
            >
              {c.emoji} {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label className="field__label">Сезон (необяз.)</label>
        <div className="chips">
          {SEASONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`chip${season === s.id ? ' is-active' : ''}`}
              onClick={() => {
                selectionChanged();
                setSeason(season === s.id ? '' : s.id);
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label className="field__label">Цвет (необяз.)</label>
        <input className="input" value={color} onChange={(e) => setColor(e.target.value)} placeholder="Напр. синий" />
      </div>
      <div className="field">
        <label className="field__label">Бренд (необяз.)</label>
        <input className="input" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Напр. Uniqlo" />
      </div>
      <div className="field">
        <label className="field__label">Размер (необяз.)</label>
        <input className="input" value={size} onChange={(e) => setSize(e.target.value)} placeholder="Напр. M / 42" />
      </div>
      <div className="field">
        <label className="field__label">Цена (необяз.)</label>
        <input
          className="input"
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="₽ — для цены за носку"
        />
      </div>
      <div className="field">
        <label className="field__label">Заметка (необяз.)</label>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Любые детали" />
      </div>

      <button className="btn btn--primary btn--block" disabled={!valid} onClick={submit}>
        {existing ? 'Сохранить' : 'Добавить'}
      </button>
    </Screen>
  );
}
