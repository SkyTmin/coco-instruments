import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Screen } from '@/components/ui';
import { Photo } from '@/components/Photo';
import { IconCheck } from '@/components/icons';
import { useFinanceStore } from '@/store';
import { CATEGORIES, CATEGORY_EMOJI } from '@/lib/clothing';
import { attachmentHref, composeMosaic, fileToAttachment } from '@/lib/images';
import type { WardrobeItem } from '@/types';
import { notifySuccess, selectionChanged, tapLight } from '@/lib/haptics';

export function ComposePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const wardrobe = useFinanceStore((s) => s.wardrobe);
  const fitting = useFinanceStore((s) => s.fitting);
  const toggleFitting = useFinanceStore((s) => s.toggleFitting);
  const clearFitting = useFinanceStore((s) => s.clearFitting);
  const addOutfit = useFinanceStore((s) => s.addOutfit);

  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  // Seed the fitting room with ?from=<itemId> once.
  const from = params.get('from');
  useEffect(() => {
    if (!from) return;
    const st = useFinanceStore.getState();
    if (!st.fitting.includes(from) && st.wardrobe.some((w) => w.id === from)) st.toggleFitting(from);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byId = useMemo(() => new Map(wardrobe.map((w) => [w.id, w])), [wardrobe]);
  const selected = fitting.map((id) => byId.get(id)).filter((w): w is WardrobeItem => Boolean(w));
  const lanes = CATEGORIES.map((c) => ({ cat: c, items: wardrobe.filter((w) => w.category === c.id) })).filter(
    (l) => l.items.length,
  );

  const save = async () => {
    if (!selected.length) return;
    setSaving(true);
    try {
      let cover;
      const srcs = selected.map((it) => (it.photo ? attachmentHref(it.photo) : '')).filter(Boolean);
      if (srcs.length) {
        const blob = await composeMosaic(srcs);
        if (blob) cover = await fileToAttachment(new File([blob], 'outfit.jpg', { type: 'image/jpeg' }));
      }
      const created = addOutfit({
        name: name.trim() || 'Новый образ',
        note: note.trim() || undefined,
        itemIds: selected.map((s) => s.id),
        cover,
      });
      clearFitting();
      notifySuccess();
      navigate(`/clothing/outfits/${created.id}`, { replace: true });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen
      title="Собрать образ"
      subtitle="Примерочная"
      action={
        <button
          className="icon-btn notes-save"
          onClick={() => void save()}
          disabled={!selected.length || saving}
          aria-label="Сохранить образ"
        >
          <IconCheck size={21} />
        </button>
      }
    >
      <div className="compose-preview">
        {selected.length === 0 ? (
          <div className="compose-preview__empty">
            <span className="compose-preview__emoji">🪞</span>
            <b>Примерочная пустая</b>
            <i>Выбирайте вещи снизу — они появятся здесь</i>
          </div>
        ) : (
          <div className="compose-stage">
            {selected.map((it) => (
              <div key={it.id} className="compose-piece">
                <button
                  className="compose-piece__photo"
                  onClick={() => {
                    tapLight();
                    navigate(`/clothing/wardrobe/${it.id}`);
                  }}
                >
                  {it.photo ? (
                    <Photo src={attachmentHref(it.photo)} contain />
                  ) : (
                    <span className="compose-piece__ph">{CATEGORY_EMOJI[it.category]}</span>
                  )}
                </button>
                <button
                  className="compose-piece__del"
                  onClick={() => {
                    selectionChanged();
                    toggleFitting(it.id);
                  }}
                  aria-label="Убрать"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {selected.length > 0 && (
        <div className="compose-meta">
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Название образа (необяз.)"
          />
          <input
            className="input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Короткая заметка (необяз.)"
          />
        </div>
      )}

      {lanes.length === 0 ? (
        <p className="muted" style={{ textAlign: 'center', padding: 16 }}>
          Гардероб пуст — сначала добавьте вещи.
        </p>
      ) : (
        lanes.map((l) => (
          <div key={l.cat.id} className="compose-lane">
            <div className="compose-lane__head">
              {l.cat.emoji} {l.cat.label}
            </div>
            <div className="compose-lane__row">
              {l.items.map((it) => {
                const on = fitting.includes(it.id);
                return (
                  <button
                    key={it.id}
                    className={`compose-chip${on ? ' is-on' : ''}`}
                    onClick={() => {
                      selectionChanged();
                      toggleFitting(it.id);
                    }}
                  >
                    {it.photo ? (
                      <Photo src={attachmentHref(it.photo)} />
                    ) : (
                      <span className="compose-chip__ph">{CATEGORY_EMOJI[it.category]}</span>
                    )}
                    {on && <i className="compose-chip__on">✓</i>}
                  </button>
                );
              })}
            </div>
          </div>
        ))
      )}

      <button
        className="btn btn--primary btn--block"
        style={{ marginTop: 16 }}
        disabled={!selected.length || saving}
        onClick={() => void save()}
      >
        {saving ? 'Сохраняем…' : 'Сохранить образ'}
      </button>
      {selected.length > 0 && (
        <button
          className="btn btn--ghost btn--block"
          style={{ marginTop: 10 }}
          onClick={() => {
            selectionChanged();
            clearFitting();
          }}
        >
          Очистить примерочную
        </button>
      )}

      {saving && (
        <div className="bulk-overlay">
          <div className="bulk-overlay__card">
            <div className="bulk-overlay__spin" />
            Собираем обложку…
          </div>
        </div>
      )}
    </Screen>
  );
}
