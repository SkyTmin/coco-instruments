import { useState } from 'react';
import { Screen } from '@/components/ui';
import { IconPlus, IconTrash } from '@/components/icons';
import { useFinanceStore } from '@/store';
import { SIZE_CATEGORIES, type Gender } from '@/lib/clothing-sizes';
import { genId } from '@/lib/id';
import { notifySuccess, selectionChanged, tapLight } from '@/lib/haptics';

export function SizesPage() {
  const sizes = useFinanceStore((s) => s.sizes);
  const setSizes = useFinanceStore((s) => s.setSizes);
  const [tab, setTab] = useState<'record' | 'calc'>('record');

  const addRow = () => {
    selectionChanged();
    setSizes([...sizes, { id: genId(), label: '', value: '' }]);
  };
  const updateRow = (id: string, patch: { label?: string; value?: string }) =>
    setSizes(sizes.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeRow = (id: string) => {
    selectionChanged();
    setSizes(sizes.filter((r) => r.id !== id));
  };

  return (
    <Screen title="Размеры">
      <div className="tabs">
        <button
          className={`tabs__tab${tab === 'record' ? ' is-active' : ''}`}
          onClick={() => {
            tapLight();
            setTab('record');
          }}
        >
          Мои размеры
        </button>
        <button
          className={`tabs__tab${tab === 'calc' ? ' is-active' : ''}`}
          onClick={() => {
            tapLight();
            setTab('calc');
          }}
        >
          Калькулятор
        </button>
      </div>

      {tab === 'record' ? (
        <div className="stack">
          {sizes.length === 0 && (
            <p className="muted" style={{ textAlign: 'center', padding: '8px 10px', lineHeight: 1.5 }}>
              Сохраните свои размеры, чтобы не вспоминать их в магазине. Или посчитайте их во вкладке
              «Калькулятор».
            </p>
          )}
          {sizes.map((r) => (
            <div key={r.id} className="size-row">
              <input
                className="input"
                value={r.label}
                placeholder="Что (напр. Футболка)"
                onChange={(e) => updateRow(r.id, { label: e.target.value })}
              />
              <input
                className="input"
                value={r.value}
                placeholder="Размер (M)"
                onChange={(e) => updateRow(r.id, { value: e.target.value })}
              />
              <button className="icon-btn" onClick={() => removeRow(r.id)} aria-label="Удалить">
                <IconTrash size={18} />
              </button>
            </div>
          ))}
          <button className="btn btn--block" onClick={addRow}>
            <span className="row" style={{ justifyContent: 'center', gap: 8 }}>
              <IconPlus size={18} /> Добавить строку
            </span>
          </button>
        </div>
      ) : (
        <SizeCalculator
          onSave={(label, value) => {
            setSizes([...sizes, { id: genId(), label, value }]);
            notifySuccess();
            setTab('record');
          }}
        />
      )}
    </Screen>
  );
}

function SizeCalculator({ onSave }: { onSave: (label: string, value: string) => void }) {
  const [catId, setCatId] = useState(SIZE_CATEGORIES[0].id);
  const [gender, setGender] = useState<Gender>('male');
  const [vals, setVals] = useState<Record<string, string>>({});

  const cat = SIZE_CATEGORIES.find((c) => c.id === catId)!;
  const nums: Record<string, number> = {};
  for (const f of cat.fields) {
    const n = parseFloat((vals[f.key] ?? '').replace(',', '.'));
    if (Number.isFinite(n)) nums[f.key] = n;
  }
  const ready = (nums[cat.fields[0].key] ?? 0) > 0;
  const results = ready ? cat.compute(nums, gender) : [];

  return (
    <div className="stack">
      <div className="field">
        <label className="field__label">Категория</label>
        <div className="chips">
          {SIZE_CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`chip${catId === c.id ? ' is-active' : ''}`}
              onClick={() => {
                selectionChanged();
                setCatId(c.id);
                setVals({});
              }}
            >
              {c.emoji} {c.label}
            </button>
          ))}
        </div>
      </div>

      {cat.usesGender && (
        <div className="field">
          <label className="field__label">Пол</label>
          <div className="segmented">
            <button
              className={`segmented__opt${gender === 'male' ? ' is-active' : ''}`}
              onClick={() => setGender('male')}
            >
              Мужской
            </button>
            <button
              className={`segmented__opt${gender === 'female' ? ' is-active' : ''}`}
              onClick={() => setGender('female')}
            >
              Женский
            </button>
          </div>
        </div>
      )}

      {cat.fields.map((f) => (
        <div className="field" key={f.key}>
          <label className="field__label">
            {f.label}, {f.unit}
          </label>
          <input
            className="input"
            inputMode="decimal"
            value={vals[f.key] ?? ''}
            placeholder={f.placeholder}
            onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))}
          />
        </div>
      ))}

      {ready && (
        <div className="card">
          <div className="stat-grid">
            {results.map((r) => (
              <div key={r.label} className="stat-tile">
                <div className="stat-tile__label">{r.label}</div>
                <div className="stat-tile__value">{r.value}</div>
              </div>
            ))}
          </div>
          <button
            className="btn btn--primary btn--block"
            style={{ marginTop: 14 }}
            onClick={() => onSave(cat.recordLabel, results.map((r) => r.value).join(' · '))}
          >
            Сохранить в мои размеры
          </button>
        </div>
      )}
    </div>
  );
}
