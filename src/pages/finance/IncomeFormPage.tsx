import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Screen } from '@/components/ui';
import type { IncomeScheme, IntervalUnit } from '@/types';
import { useFinanceStore, type IncomeSourceDraft } from '@/store';
import {
  DEFAULT_NIGHT_BONUS_PERCENT,
  SHIFT_PRESETS,
  VAHTA_PRESETS,
  monthlyIncome,
  nextIncome,
} from '@/lib/income';
import { todayISO } from '@/lib/date';
import { formatDate, formatRUB } from '@/lib/format';
import { notifySuccess, selectionChanged } from '@/lib/haptics';

const SCHEMES: { value: IncomeScheme; label: string; hint: string }[] = [
  { value: 'salary', label: '💼 Оклад', hint: 'Аванс + зарплата дважды в месяц' },
  { value: 'vahta', label: '⛏ Вахта', hint: 'Цикл работа/отдых + вахтовая надбавка' },
  { value: 'shift', label: '🕑 Смены', hint: '2/2, 3/3, сутки-трое — ставка × смены' },
  { value: 'recurring', label: '🔁 Регулярный', hint: 'Аренда, пенсия и т.п.' },
  { value: 'oneoff', label: '➕ Разовый', hint: 'Фриланс, продажа, подарок' },
];

const UNITS: { value: IntervalUnit; label: string }[] = [
  { value: 'week', label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
  { value: 'year', label: 'Год' },
];

function num(s: string): number {
  const n = parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

export function IncomeFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const existing = useFinanceStore((s) => (id ? s.getIncomeSource(id) : undefined));
  const addIncomeSource = useFinanceStore((s) => s.addIncomeSource);
  const updateIncomeSource = useFinanceStore((s) => s.updateIncomeSource);

  const [name, setName] = useState(existing?.name ?? '');
  const [scheme, setScheme] = useState<IncomeScheme>(existing?.scheme ?? 'salary');
  const [monthlyNet, setMonthlyNet] = useState(
    existing?.monthlyNet ? String(existing.monthlyNet) : '',
  );
  const [advancePercent, setAdvancePercent] = useState(String(existing?.advancePercent ?? 45));
  const [advanceDay, setAdvanceDay] = useState(String(existing?.advanceDay ?? 25));
  const [salaryDay, setSalaryDay] = useState(String(existing?.salaryDay ?? 10));
  const [dayRate, setDayRate] = useState(existing?.dayRate ? String(existing.dayRate) : '');
  const [hourRate, setHourRate] = useState(existing?.hourRate ? String(existing.hourRate) : '');
  const [onDays, setOnDays] = useState(String(existing?.onDays ?? 15));
  const [offDays, setOffDays] = useState(String(existing?.offDays ?? 15));
  const [shiftHours, setShiftHours] = useState(String(existing?.shiftHours ?? 12));
  const [allowance, setAllowance] = useState(
    existing?.vahtaAllowancePerDay ? String(existing.vahtaAllowancePerDay) : '700',
  );
  const [districtCoeff, setDistrictCoeff] = useState(String(existing?.districtCoeff ?? 1));
  const [northPercent, setNorthPercent] = useState(String(existing?.northPercent ?? 0));
  const [nightBonus, setNightBonus] = useState(
    String(existing?.nightBonusPercent ?? DEFAULT_NIGHT_BONUS_PERCENT),
  );
  const [intervalCount, setIntervalCount] = useState(String(existing?.intervalCount ?? 1));
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>(existing?.intervalUnit ?? 'month');
  const [startDate, setStartDate] = useState(existing?.startDate ?? todayISO());

  const draft: IncomeSourceDraft = useMemo(
    () => ({
      name: name.trim() || 'Доход',
      scheme,
      monthlyNet: num(monthlyNet) || undefined,
      advancePercent: num(advancePercent) || undefined,
      advanceDay: Math.round(num(advanceDay)) || undefined,
      salaryDay: Math.round(num(salaryDay)) || undefined,
      dayRate: num(dayRate) || undefined,
      hourRate: num(hourRate) || undefined,
      onDays: Math.round(num(onDays)) || undefined,
      offDays: Math.round(num(offDays)) || undefined,
      shiftHours: Math.round(num(shiftHours)) || undefined,
      vahtaAllowancePerDay: num(allowance) || undefined,
      districtCoeff: num(districtCoeff) || undefined,
      northPercent: num(northPercent) || undefined,
      nightBonusPercent: num(nightBonus),
      intervalCount: Math.round(num(intervalCount)) || undefined,
      intervalUnit,
      startDate: startDate || todayISO(),
      paused: existing?.paused ?? false,
    }),
    [
      name,
      scheme,
      monthlyNet,
      advancePercent,
      advanceDay,
      salaryDay,
      dayRate,
      hourRate,
      onDays,
      offDays,
      shiftHours,
      allowance,
      districtCoeff,
      northPercent,
      nightBonus,
      intervalCount,
      intervalUnit,
      startDate,
      existing,
    ],
  );

  const preview = useMemo(() => {
    const src = { ...draft, id: 'preview', createdAt: 0, updatedAt: 0 };
    return { monthly: monthlyIncome(src), next: nextIncome(src) };
  }, [draft]);

  const pickScheme = (s: IncomeScheme) => {
    selectionChanged();
    setScheme(s);
  };
  const applyVahta = (p: (typeof VAHTA_PRESETS)[number]) => {
    selectionChanged();
    setOnDays(String(p.onDays));
    setOffDays(String(p.offDays));
  };
  const applyShift = (p: (typeof SHIFT_PRESETS)[number]) => {
    selectionChanged();
    setOnDays(String(p.onDays));
    setOffDays(String(p.offDays));
    setShiftHours(String(p.shiftHours));
  };

  const valid = name.trim().length > 0;
  const submit = () => {
    if (!valid) return;
    if (existing) updateIncomeSource(existing.id, draft);
    else addIncomeSource(draft);
    notifySuccess();
    navigate(-1);
  };

  const numField = (label: string, value: string, set: (v: string) => void, ph?: string) => (
    <div className="field">
      <label className="field__label">{label}</label>
      <input
        className="input"
        inputMode="decimal"
        value={value}
        onChange={(e) => set(e.target.value)}
        placeholder={ph}
      />
    </div>
  );

  return (
    <Screen title={existing ? 'Изменить доход' : 'Источник дохода'}>
      <div className="field">
        <label className="field__label">Название</label>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Напр. Работа на севере"
        />
      </div>

      <div className="field">
        <label className="field__label">Тип дохода</label>
        <div className="scheme-list">
          {SCHEMES.map((s) => (
            <button
              key={s.value}
              className={`scheme-opt${scheme === s.value ? ' is-active' : ''}`}
              onClick={() => pickScheme(s.value)}
            >
              <span className="scheme-opt__label">{s.label}</span>
              <span className="scheme-opt__hint">{s.hint}</span>
            </button>
          ))}
        </div>
      </div>

      {scheme === 'salary' && (
        <>
          {numField('Оклад «на руки» за месяц, ₽', monthlyNet, setMonthlyNet, '80000')}
          {numField('Доля аванса, %', advancePercent, setAdvancePercent, '45')}
          <div className="row" style={{ gap: 12 }}>
            <div style={{ flex: 1 }}>
              {numField('День аванса', advanceDay, setAdvanceDay, '25')}
            </div>
            <div style={{ flex: 1 }}>
              {numField('День зарплаты', salaryDay, setSalaryDay, '10')}
            </div>
          </div>
        </>
      )}

      {scheme === 'vahta' && (
        <>
          <div className="field">
            <label className="field__label">График вахты</label>
            <div className="preset-row">
              {VAHTA_PRESETS.map((p) => (
                <button
                  key={p.label}
                  className={`preset-chip${
                    Number(onDays) === p.onDays && Number(offDays) === p.offDays ? ' is-active' : ''
                  }`}
                  onClick={() => applyVahta(p)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="row" style={{ gap: 12 }}>
            <div style={{ flex: 1 }}>{numField('Дней работы', onDays, setOnDays, '30')}</div>
            <div style={{ flex: 1 }}>{numField('Дней отдыха', offDays, setOffDays, '30')}</div>
          </div>
          {numField('Дневная ставка, ₽', dayRate, setDayRate, '5000')}
          {numField('Вахтовая надбавка, ₽/день', allowance, setAllowance, '700')}
          <div className="row" style={{ gap: 12 }}>
            <div style={{ flex: 1 }}>
              {numField('Районный коэф.', districtCoeff, setDistrictCoeff, '1.7')}
            </div>
            <div style={{ flex: 1 }}>
              {numField('Северная, %', northPercent, setNorthPercent, '50')}
            </div>
          </div>
          <div className="row" style={{ gap: 12 }}>
            <div style={{ flex: 1 }}>
              {numField('День аванса', advanceDay, setAdvanceDay, '25')}
            </div>
            <div style={{ flex: 1 }}>
              {numField('День зарплаты', salaryDay, setSalaryDay, '10')}
            </div>
          </div>
        </>
      )}

      {scheme === 'shift' && (
        <>
          <div className="field">
            <label className="field__label">График смен</label>
            <div className="preset-row">
              {SHIFT_PRESETS.map((p) => (
                <button
                  key={p.label}
                  className={`preset-chip${
                    Number(onDays) === p.onDays &&
                    Number(offDays) === p.offDays &&
                    Number(shiftHours) === p.shiftHours
                      ? ' is-active'
                      : ''
                  }`}
                  onClick={() => applyShift(p)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="row" style={{ gap: 12 }}>
            <div style={{ flex: 1 }}>{numField('Дней работы', onDays, setOnDays, '2')}</div>
            <div style={{ flex: 1 }}>{numField('Дней отдыха', offDays, setOffDays, '2')}</div>
          </div>
          {numField('Часовая ставка, ₽', hourRate, setHourRate, '300')}
          {numField('Часов в смене', shiftHours, setShiftHours, '12')}
          {numField('Доплата за ночь, %', nightBonus, setNightBonus, '20')}
          <div className="row" style={{ gap: 12 }}>
            <div style={{ flex: 1 }}>
              {numField('День аванса', advanceDay, setAdvanceDay, '25')}
            </div>
            <div style={{ flex: 1 }}>
              {numField('День зарплаты', salaryDay, setSalaryDay, '10')}
            </div>
          </div>
        </>
      )}

      {scheme === 'recurring' && (
        <>
          {numField('Сумма выплаты, ₽', monthlyNet, setMonthlyNet, '30000')}
          <div className="field">
            <label className="field__label">Как часто</label>
            <div className="segmented">
              {UNITS.map((u) => (
                <button
                  key={u.value}
                  className={`segmented__opt${intervalUnit === u.value ? ' is-active' : ''}`}
                  onClick={() => {
                    selectionChanged();
                    setIntervalUnit(u.value);
                  }}
                >
                  {u.label}
                </button>
              ))}
            </div>
            <div className="row" style={{ gap: 10, marginTop: 10, alignItems: 'center' }}>
              <span className="muted" style={{ fontSize: 14 }}>
                Каждые
              </span>
              <input
                className="input"
                style={{ width: 90 }}
                inputMode="numeric"
                value={intervalCount}
                onChange={(e) => setIntervalCount(e.target.value)}
              />
            </div>
          </div>
        </>
      )}

      {scheme === 'oneoff' && numField('Сумма, ₽', monthlyNet, setMonthlyNet, '15000')}

      <div className="field">
        <label className="field__label">
          {scheme === 'oneoff' ? 'Дата выплаты' : 'Начало / привязка графика'}
        </label>
        <input
          className="input"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
      </div>

      {(preview.monthly > 0 || preview.next) && (
        <div className="card" style={{ marginBottom: 18 }}>
          {scheme !== 'oneoff' && (
            <div className="stat-row">
              <span className="stat-row__label">≈ в месяц</span>
              <span className="stat-row__value amount-pos">{formatRUB(preview.monthly)}</span>
            </div>
          )}
          {preview.next && (
            <div className="stat-row">
              <span className="stat-row__label">Ближайшая выплата</span>
              <span className="stat-row__value">
                {formatRUB(preview.next.amount)} · {formatDate(preview.next.date)}
              </span>
            </div>
          )}
          {(scheme === 'vahta' || scheme === 'shift') && (
            <p className="muted" style={{ margin: '8px 2px 0', fontSize: 12 }}>
              Это оценка по графику — фактическая выплата зависит от отработанных смен.
            </p>
          )}
        </div>
      )}

      <button className="btn btn--primary btn--block" disabled={!valid} onClick={submit}>
        {existing ? 'Сохранить' : 'Добавить'}
      </button>
    </Screen>
  );
}
