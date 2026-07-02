import { useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Screen } from '@/components/ui';
import type { IncomeScheme, IntervalUnit, RateMode, SalaryConfig } from '@/types';
import { useFinanceStore, type IncomeSourceDraft } from '@/store';
import { SHIFT_PRESETS, VAHTA_PRESETS, monthlyIncome, nextIncome } from '@/lib/income';
import { BUILTIN_TEMPLATES, computePayslip } from '@/lib/salary';
import { recognizePayslipPdf } from '@/lib/payslip-import';
import { todayISO } from '@/lib/date';
import { formatDate, formatRUB } from '@/lib/format';
import { notifySuccess, notifyWarning, selectionChanged } from '@/lib/haptics';

const SCHEMES: { value: IncomeScheme; label: string; hint: string }[] = [
  { value: 'salary', label: '💼 Оклад', hint: 'Фиксированный оклад + надбавки' },
  { value: 'vahta', label: '⛏ Вахта', hint: 'Цикл работа/отдых, календарь смен' },
  { value: 'shift', label: '🕑 Смены', hint: '2/2, 3/3, сутки-трое' },
  { value: 'recurring', label: '🔁 Регулярный', hint: 'Аренда, пенсия и т.п.' },
  { value: 'oneoff', label: '➕ Разовый', hint: 'Фриланс, продажа, подарок' },
];

const RATE_MODES: { value: RateMode; label: string }[] = [
  { value: 'hourly', label: 'Почасовая' },
  { value: 'daily', label: 'Дневная' },
  { value: 'monthly', label: 'Оклад' },
];

const UNITS: { value: IntervalUnit; label: string }[] = [
  { value: 'week', label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
  { value: 'year', label: 'Год' },
];

/** Schemes that use the full salary constructor (payslip engine). */
const USES_SALARY = (s: IncomeScheme) => s === 'salary' || s === 'vahta' || s === 'shift';

function num(s: string): number {
  const n = parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

const defaultConfig = (scheme: IncomeScheme): SalaryConfig => ({
  rateMode: scheme === 'shift' ? 'hourly' : scheme === 'vahta' ? 'daily' : 'monthly',
  shiftHours: scheme === 'shift' ? 12 : 11,
  vahtaEnabled: scheme === 'vahta',
  vahtaAllowancePerDay: scheme === 'vahta' ? 700 : undefined,
  nightPercent: 20,
  nightHoursPerShift: 8,
  holidayMultiplier: 2,
  overtimeMultiplier: 2,
  ndflEnabled: true,
  ndflPercent: 13,
});

export function IncomeFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const existing = useFinanceStore((s) => (id ? s.getIncomeSource(id) : undefined));
  const addIncomeSource = useFinanceStore((s) => s.addIncomeSource);
  const updateIncomeSource = useFinanceStore((s) => s.updateIncomeSource);
  const userTemplates = useFinanceStore((s) => s.salaryTemplates);
  const addSalaryTemplate = useFinanceStore((s) => s.addSalaryTemplate);
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(existing?.name ?? '');
  const [scheme, setScheme] = useState<IncomeScheme>(existing?.scheme ?? 'vahta');

  // Common payout fields
  const [advancePercent, setAdvancePercent] = useState(String(existing?.advancePercent ?? 45));
  const [advanceDay, setAdvanceDay] = useState(String(existing?.advanceDay ?? 25));
  const [salaryDay, setSalaryDay] = useState(String(existing?.salaryDay ?? 10));
  const [startDate, setStartDate] = useState(existing?.startDate ?? todayISO());
  const [onDays, setOnDays] = useState(String(existing?.onDays ?? 30));
  const [offDays, setOffDays] = useState(String(existing?.offDays ?? 30));

  // Recurring / oneoff
  const [amount, setAmount] = useState(existing?.monthlyNet ? String(existing.monthlyNet) : '');
  const [intervalCount, setIntervalCount] = useState(String(existing?.intervalCount ?? 1));
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>(existing?.intervalUnit ?? 'month');

  // Salary constructor config
  const [cfg, setCfgState] = useState<SalaryConfig>(
    existing?.salary ?? defaultConfig(existing?.scheme ?? 'vahta'),
  );
  const setCfg = (patch: Partial<SalaryConfig>) => setCfgState((c) => ({ ...c, ...patch }));

  const [importInfo, setImportInfo] = useState<string[] | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const draft: IncomeSourceDraft = useMemo(() => {
    const base: IncomeSourceDraft = {
      name: name.trim() || 'Доход',
      scheme,
      advancePercent: num(advancePercent) || undefined,
      advanceDay: Math.round(num(advanceDay)) || undefined,
      salaryDay: Math.round(num(salaryDay)) || undefined,
      startDate: startDate || todayISO(),
      paused: existing?.paused ?? false,
      calendar: existing?.calendar,
    };
    if (USES_SALARY(scheme)) {
      return {
        ...base,
        salary: cfg,
        onDays: scheme === 'salary' ? undefined : Math.round(num(onDays)) || undefined,
        offDays: scheme === 'salary' ? undefined : Math.round(num(offDays)) || undefined,
      };
    }
    if (scheme === 'recurring') {
      return {
        ...base,
        monthlyNet: num(amount) || undefined,
        intervalCount: Math.round(num(intervalCount)) || undefined,
        intervalUnit,
      };
    }
    return { ...base, monthlyNet: num(amount) || undefined };
  }, [
    name,
    scheme,
    advancePercent,
    advanceDay,
    salaryDay,
    startDate,
    onDays,
    offDays,
    cfg,
    amount,
    intervalCount,
    intervalUnit,
    existing,
  ]);

  const preview = useMemo(() => {
    const src = { ...draft, id: existing?.id ?? 'preview', createdAt: 0, updatedAt: 0 };
    const payslip = USES_SALARY(scheme) ? computePayslip(src, todayISO().slice(0, 7)) : null;
    return { monthly: monthlyIncome(src), next: nextIncome(src), payslip };
  }, [draft, scheme, existing]);

  const pickScheme = (s: IncomeScheme) => {
    selectionChanged();
    setScheme(s);
    if (USES_SALARY(s) && !existing) setCfgState(defaultConfig(s));
  };

  const applyTemplate = (config: SalaryConfig) => {
    selectionChanged();
    setCfgState({ ...config });
  };

  const importPdf = async (file: File) => {
    setImportError(null);
    setImportInfo(null);
    try {
      const { config, found } = await recognizePayslipPdf(file);
      if (found.length === 0) {
        setImportError(
          'Не удалось распознать параметры. Введите вручную или попробуйте другой файл.',
        );
        return;
      }
      setCfgState((c) => ({ ...c, ...config }));
      setImportInfo(found);
      notifySuccess();
    } catch {
      setImportError('Это похоже на скан без текста. Нужен PDF с текстовым слоем.');
      notifyWarning();
    }
  };

  const saveAsTemplate = () => {
    const tplName = window.prompt('Название шаблона (например, работодатель):', name.trim());
    if (tplName && tplName.trim()) {
      addSalaryTemplate(tplName.trim(), cfg);
      notifySuccess();
    }
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

  const cfgNum = (label: string, key: keyof SalaryConfig, ph?: string) => (
    <div className="field">
      <label className="field__label">{label}</label>
      <input
        className="input"
        inputMode="decimal"
        value={cfg[key] === undefined ? '' : String(cfg[key])}
        onChange={(e) =>
          setCfg({ [key]: num(e.target.value) || undefined } as Partial<SalaryConfig>)
        }
        placeholder={ph}
      />
    </div>
  );

  /** A switchable supplement: toggle + revealed inputs. */
  const toggle = (label: string, enabledKey: keyof SalaryConfig, body: React.ReactNode) => (
    <div className="supp">
      <label className="toggle-row">
        <span>{label}</span>
        <input
          type="checkbox"
          checked={!!cfg[enabledKey]}
          onChange={(e) => setCfg({ [enabledKey]: e.target.checked } as Partial<SalaryConfig>)}
        />
      </label>
      {cfg[enabledKey] && <div className="supp__body">{body}</div>}
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
          placeholder="Напр. Газпром бурение"
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

      {USES_SALARY(scheme) && (
        <>
          {/* Шаблоны работодателей */}
          <div className="field">
            <label className="field__label">Шаблон (применить настройки)</label>
            <div className="preset-row">
              {BUILTIN_TEMPLATES.map((t) => (
                <button
                  key={t.name}
                  className="preset-chip"
                  onClick={() => applyTemplate(t.config)}
                >
                  {t.name.replace(' (примерно)', '')}
                </button>
              ))}
              {userTemplates.map((t) => (
                <button key={t.id} className="preset-chip" onClick={() => applyTemplate(t.config)}>
                  ⭐ {t.name}
                </button>
              ))}
            </div>
          </div>

          {/* Обучение по расчётному листку */}
          <div className="field">
            <label className="field__label">Обучение по расчётному листку (PDF)</label>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importPdf(f);
                e.target.value = '';
              }}
            />
            <button className="btn btn--ghost btn--block" onClick={() => fileRef.current?.click()}>
              📄 Загрузить расчётный лист
            </button>
            {importInfo && (
              <div className="import-found">
                <b>Распознано:</b>
                <ul>
                  {importInfo.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
            )}
            {importError && (
              <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                {importError}
              </p>
            )}
          </div>

          {/* Режим ставки */}
          <div className="field">
            <label className="field__label">Как считается оплата</label>
            <div className="segmented">
              {RATE_MODES.map((r) => (
                <button
                  key={r.value}
                  className={`segmented__opt${cfg.rateMode === r.value ? ' is-active' : ''}`}
                  onClick={() => {
                    selectionChanged();
                    setCfg({ rateMode: r.value });
                  }}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {cfg.rateMode === 'hourly' && (
            <>
              {cfgNum('Ставка за час, ₽', 'hourRate', '350')}
              {cfgNum('Часов в смене', 'shiftHours', '11')}
            </>
          )}
          {cfg.rateMode === 'daily' && (
            <>
              {cfgNum('Дневная ставка, ₽', 'dayRate', '5000')}
              {cfgNum('Часов в смене', 'shiftHours', '11')}
            </>
          )}
          {cfg.rateMode === 'monthly' && cfgNum('Оклад за месяц, ₽', 'monthlyBase', '100000')}

          {/* График (только вахта/смены) */}
          {scheme !== 'salary' && (
            <div className="field">
              <label className="field__label">График</label>
              <div className="preset-row">
                {(scheme === 'vahta' ? VAHTA_PRESETS : SHIFT_PRESETS).map((p) => (
                  <button
                    key={p.label}
                    className={`preset-chip${
                      Number(onDays) === p.onDays && Number(offDays) === p.offDays
                        ? ' is-active'
                        : ''
                    }`}
                    onClick={() => {
                      selectionChanged();
                      setOnDays(String(p.onDays));
                      setOffDays(String(p.offDays));
                      if ('shiftHours' in p)
                        setCfg({ shiftHours: (p as { shiftHours: number }).shiftHours });
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="row" style={{ gap: 12, marginTop: 10 }}>
                <div style={{ flex: 1 }}>{numField('Дней работы', onDays, setOnDays)}</div>
                <div style={{ flex: 1 }}>{numField('Дней отдыха', offDays, setOffDays)}</div>
              </div>
              {existing && (
                <button
                  className="btn btn--ghost btn--block"
                  style={{ marginTop: 8 }}
                  onClick={() => navigate(`/finance/income/${existing.id}/calendar`)}
                >
                  🗓 Открыть календарь смен
                </button>
              )}
            </div>
          )}

          {/* Надбавки — каждую можно включить/выключить */}
          <div className="section-label">Надбавки</div>
          {toggle(
            'Премия',
            'premiumEnabled',
            <>
              <div className="segmented" style={{ marginBottom: 10 }}>
                <button
                  className={`segmented__opt${cfg.premiumMode !== 'fixed' ? ' is-active' : ''}`}
                  onClick={() => setCfg({ premiumMode: 'percent' })}
                >
                  Процент
                </button>
                <button
                  className={`segmented__opt${cfg.premiumMode === 'fixed' ? ' is-active' : ''}`}
                  onClick={() => setCfg({ premiumMode: 'fixed' })}
                >
                  Фикс. сумма
                </button>
              </div>
              {cfgNum(cfg.premiumMode === 'fixed' ? 'Премия, ₽' : 'Премия, %', 'premiumValue')}
            </>,
          )}
          {toggle(
            'Районный коэффициент',
            'districtEnabled',
            cfgNum('Коэффициент (напр. 1.7)', 'districtCoeff', '1.7'),
          )}
          {toggle('Северная надбавка', 'northEnabled', cfgNum('Северная, %', 'northPercent', '50'))}
          {toggle(
            'Надбавка за особые условия',
            'specialEnabled',
            <>
              <div className="segmented" style={{ marginBottom: 10 }}>
                <button
                  className={`segmented__opt${cfg.specialMode !== 'fixed' ? ' is-active' : ''}`}
                  onClick={() => setCfg({ specialMode: 'percent' })}
                >
                  Процент
                </button>
                <button
                  className={`segmented__opt${cfg.specialMode === 'fixed' ? ' is-active' : ''}`}
                  onClick={() => setCfg({ specialMode: 'fixed' })}
                >
                  Фикс. сумма
                </button>
              </div>
              {cfgNum(cfg.specialMode === 'fixed' ? 'Сумма, ₽' : 'Процент, %', 'specialValue')}
            </>,
          )}
          {toggle(
            'Вахтовая надбавка',
            'vahtaEnabled',
            cfgNum('₽ за рабочий день', 'vahtaAllowancePerDay', '700'),
          )}
          {toggle(
            'Оплата праздничных смен',
            'holidayEnabled',
            cfgNum('Множитель (обычно 2)', 'holidayMultiplier', '2'),
          )}
          {toggle(
            'Ночные часы',
            'nightEnabled',
            <div className="row" style={{ gap: 12 }}>
              <div style={{ flex: 1 }}>{cfgNum('Доплата, %', 'nightPercent', '20')}</div>
              <div style={{ flex: 1 }}>
                {cfgNum('Ночных часов/смена', 'nightHoursPerShift', '8')}
              </div>
            </div>,
          )}
          {toggle(
            'Сверхурочные',
            'overtimeEnabled',
            cfgNum('Множитель (обычно 2)', 'overtimeMultiplier', '2'),
          )}

          {/* НДФЛ */}
          <div className="section-label">Налог</div>
          {toggle(
            'Вычитать НДФЛ (показывать «на руки»)',
            'ndflEnabled',
            cfgNum('НДФЛ, %', 'ndflPercent', '13'),
          )}

          {/* Аванс */}
          <div className="section-label">Аванс и зарплата</div>
          {numField('Доля аванса, %', advancePercent, setAdvancePercent, '45')}
          <div className="row" style={{ gap: 12 }}>
            <div style={{ flex: 1 }}>
              {numField('День аванса', advanceDay, setAdvanceDay, '25')}
            </div>
            <div style={{ flex: 1 }}>
              {numField('День зарплаты', salaryDay, setSalaryDay, '10')}
            </div>
          </div>

          <button
            className="btn btn--ghost btn--block"
            style={{ marginTop: 4 }}
            onClick={saveAsTemplate}
          >
            ⭐ Сохранить как шаблон
          </button>
        </>
      )}

      {scheme === 'recurring' && (
        <>
          {numField('Сумма выплаты, ₽', amount, setAmount, '30000')}
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

      {scheme === 'oneoff' && numField('Сумма, ₽', amount, setAmount, '15000')}

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

      {/* Живой предпросмотр расчётного листка */}
      {preview.payslip && preview.payslip.gross > 0 && (
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="stat-row">
            <span className="stat-row__label">Начислено (грязными)</span>
            <span className="stat-row__value">{formatRUB(preview.payslip.gross)}</span>
          </div>
          <div className="stat-row">
            <span className="stat-row__label">На руки в месяц</span>
            <span className="stat-row__value amount-pos">{formatRUB(preview.payslip.net)}</span>
          </div>
          <div className="stat-row">
            <span className="stat-row__label">Аванс / зарплата</span>
            <span className="stat-row__value">
              {formatRUB(preview.payslip.advance)} / {formatRUB(preview.payslip.salary)}
            </span>
          </div>
          <p className="muted" style={{ margin: '8px 2px 0', fontSize: 12 }}>
            Прикидка на текущий месяц. Точный лист — по календарю смен после сохранения.
          </p>
        </div>
      )}

      {!preview.payslip && (preview.monthly > 0 || preview.next) && (
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
        </div>
      )}

      <button className="btn btn--primary btn--block" disabled={!valid} onClick={submit}>
        {existing ? 'Сохранить' : 'Добавить'}
      </button>
    </Screen>
  );
}
