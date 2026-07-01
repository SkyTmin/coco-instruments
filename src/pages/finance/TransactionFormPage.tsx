import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Screen } from '@/components/ui';
import type { TxDirection } from '@/types';
import { useFinanceStore, type TransactionDraft } from '@/store';
import { categoriesFor } from '@/lib/categories';
import { todayISO } from '@/lib/date';
import { notifySuccess, selectionChanged } from '@/lib/haptics';

function num(s: string): number {
  const n = parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

export function TransactionFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const existing = useFinanceStore((s) => (id ? s.getTransaction(id) : undefined));
  const addTransaction = useFinanceStore((s) => s.addTransaction);
  const updateTransaction = useFinanceStore((s) => s.updateTransaction);
  const lists = useFinanceStore((s) => s.lists);
  const [params] = useSearchParams();

  const initialDir: TxDirection =
    existing?.direction ?? (params.get('dir') === 'income' ? 'income' : 'expense');
  const [direction, setDirection] = useState<TxDirection>(initialDir);
  const [amount, setAmount] = useState(existing ? String(existing.amount) : '');
  const [category, setCategory] = useState(existing?.category ?? categoriesFor(initialDir)[0].id);
  const [date, setDate] = useState(existing?.date ?? todayISO());
  const [note, setNote] = useState(existing?.note ?? '');
  const [listId, setListId] = useState(existing?.listId ?? params.get('list') ?? '');

  const cats = categoriesFor(direction);
  const valid = num(amount) > 0;

  const pickDirection = (d: TxDirection) => {
    if (d === direction) return;
    selectionChanged();
    setDirection(d);
    // Keep the category valid for the new direction.
    if (!categoriesFor(d).some((c) => c.id === category)) setCategory(categoriesFor(d)[0].id);
  };

  const submit = () => {
    if (!valid) return;
    const draft: TransactionDraft = {
      direction,
      amount: Math.round(num(amount)),
      date: date || todayISO(),
      category,
      note: note.trim() || undefined,
      listId: listId || undefined,
      incomeSourceId: existing?.incomeSourceId,
    };
    if (existing) updateTransaction(existing.id, draft);
    else addTransaction(draft);
    notifySuccess();
    navigate(-1);
  };

  return (
    <Screen title={existing ? 'Изменить запись' : 'Новая запись'}>
      <div className="segmented" style={{ marginBottom: 16 }}>
        <button
          className={`segmented__opt${direction === 'expense' ? ' is-active' : ''}`}
          onClick={() => pickDirection('expense')}
        >
          💸 Расход
        </button>
        <button
          className={`segmented__opt${direction === 'income' ? ' is-active' : ''}`}
          onClick={() => pickDirection('income')}
        >
          💰 Доход
        </button>
      </div>

      <div className="field">
        <label className="field__label">Сумма</label>
        <input
          className="input"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="500"
          autoFocus
        />
      </div>

      <div className="field">
        <label className="field__label">Категория</label>
        <div className="chip-grid">
          {cats.map((c) => (
            <button
              key={c.id}
              className={`cat-chip${category === c.id ? ' is-active' : ''}`}
              style={category === c.id ? { borderColor: c.color, color: c.color } : undefined}
              onClick={() => {
                selectionChanged();
                setCategory(c.id);
              }}
            >
              <span className="cat-chip__emoji">{c.emoji}</span>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label className="field__label">Дата</label>
        <input
          className="input"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>

      <div className="field">
        <label className="field__label">Заметка (необязательно)</label>
        <input
          className="input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Напр. продукты в Пятёрочке"
        />
      </div>

      {lists.length > 0 && (
        <div className="field">
          <label className="field__label">Список</label>
          <select className="select" value={listId} onChange={(e) => setListId(e.target.value)}>
            <option value="">Без списка</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {(l.emoji ? `${l.emoji} ` : '') + l.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <button className="btn btn--primary btn--block" disabled={!valid} onClick={submit}>
        {existing ? 'Сохранить' : 'Добавить'}
      </button>
    </Screen>
  );
}
