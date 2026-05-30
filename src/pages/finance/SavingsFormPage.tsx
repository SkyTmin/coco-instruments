import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Screen } from '@/components/ui';
import { useFinanceStore } from '@/store';
import { notifySuccess } from '@/lib/haptics';

function num(s: string): number {
  const n = parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

export function SavingsFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const existing = useFinanceStore((s) => (id ? s.getSaving(id) : undefined));
  const addSaving = useFinanceStore((s) => s.addSaving);
  const updateSaving = useFinanceStore((s) => s.updateSaving);

  const [name, setName] = useState(existing?.name ?? '');
  const [target, setTarget] = useState(existing ? String(existing.targetAmount) : '');
  const [current, setCurrent] = useState(existing ? String(existing.currentAmount) : '0');
  const [deadline, setDeadline] = useState(existing?.deadline ?? '');

  const valid = name.trim().length > 0 && num(target) > 0;

  const submit = () => {
    if (!valid) return;
    const data = {
      name,
      targetAmount: num(target),
      currentAmount: num(current),
      deadline: deadline || undefined,
    };
    if (existing) updateSaving(existing.id, data);
    else addSaving(data);
    notifySuccess();
    navigate(-1);
  };

  return (
    <Screen title={existing ? 'Изменить цель' : 'Новая цель'}>
      <div className="field">
        <label className="field__label">Название</label>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Напр. На отпуск"
        />
      </div>
      <div className="field">
        <label className="field__label">Цель (сколько накопить)</label>
        <input
          className="input"
          inputMode="decimal"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="200000"
        />
      </div>
      <div className="field">
        <label className="field__label">Уже накоплено</label>
        <input
          className="input"
          inputMode="decimal"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          placeholder="0"
        />
      </div>
      <div className="field">
        <label className="field__label">Срок (необязательно)</label>
        <input
          className="input"
          type="date"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
        />
      </div>

      <button className="btn btn--primary btn--block" disabled={!valid} onClick={submit}>
        {existing ? 'Сохранить' : 'Создать цель'}
      </button>
    </Screen>
  );
}
