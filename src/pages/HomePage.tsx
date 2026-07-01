import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatedNumber, ConfirmDialog, Screen, Sheet, Skeleton } from '@/components/ui';
import {
  IconCalculator,
  IconGear,
  IconHeart,
  IconNotes,
  IconSearch,
  IconShirt,
  IconWallet,
} from '@/components/icons';
import { useFinanceStore } from '@/store';
import { collectPayments, computeObligation, computeRecurring } from '@/lib/finance-calc';
import { toISO, todayISO } from '@/lib/date';
import { formatRUB, pluralizeRu, relativeDay } from '@/lib/format';
import { nextBirthday, peopleUpcomingEvents, peopleWord } from '@/lib/people';
import { getBackupStatus, requestTelegramBackup } from '@/lib/backup';
import { notifySuccess, notifyWarning, selectionChanged, tapLight } from '@/lib/haptics';
import { setThemePref, useThemePref } from '@/lib/theme';
import { versionLabel } from '@/version';

const dateFmt = new Intl.DateTimeFormat('ru-RU', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

function greeting(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'Доброе утро';
  if (h >= 12 && h < 18) return 'Добрый день';
  if (h >= 18 && h < 23) return 'Добрый вечер';
  return 'Доброй ночи';
}

interface TodayFact {
  key: string;
  emoji: string;
  text: string;
  accent?: string;
  to: string;
}

export function HomePage() {
  const navigate = useNavigate();
  const expenses = useFinanceStore((s) => s.expenses);
  const recurring = useFinanceStore((s) => s.recurring);
  const notes = useFinanceStore((s) => s.notes);
  const people = useFinanceStore((s) => s.people);
  const gifts = useFinanceStore((s) => s.gifts);
  const promises = useFinanceStore((s) => s.promises);
  const meetIdeas = useFinanceStore((s) => s.meetIdeas);
  const wardrobe = useFinanceStore((s) => s.wardrobe);
  const outfits = useFinanceStore((s) => s.outfits);
  const hydrated = useFinanceStore((s) => s.hydrated);
  const exportAll = useFinanceStore((s) => s.exportAll);
  const importAll = useFinanceStore((s) => s.importAll);

  const fin = useMemo(() => {
    let monthly = 0;
    let remaining = 0;
    for (const o of expenses) {
      if (o.status === 'closed') continue;
      const c = computeObligation(o);
      monthly += c.monthlyPayment;
      remaining += c.remaining;
    }
    for (const r of recurring) {
      if (r.paused) continue;
      monthly += computeRecurring(r).monthlyEquivalent;
    }
    return {
      monthly: Math.round(monthly),
      remaining: Math.round(remaining),
      has: expenses.length > 0 || recurring.length > 0,
    };
  }, [expenses, recurring]);

  // «Сегодня»: живые факты дня — ближайший платёж, ДР, напоминания.
  const today = useMemo<TodayFact[]>(() => {
    const facts: TodayFact[] = [];
    const base = new Date();
    const end = toISO(new Date(base.getFullYear(), base.getMonth() + 3, 0));
    const payment = collectPayments(todayISO(), end, expenses, recurring)[0];
    if (payment) {
      facts.push({
        key: 'pay',
        emoji: '💳',
        text: `${payment.name} · ${relativeDay(payment.date)}`,
        accent: formatRUB(payment.amount),
        to: '/finance',
      });
    }
    const birthday = people
      .flatMap((person) => {
        const b = nextBirthday(person);
        return b ? [{ person, b }] : [];
      })
      .sort((x, y) => x.b.days - y.b.days)[0];
    if (birthday) {
      facts.push({
        key: 'bd',
        emoji: '🎂',
        text: `${birthday.person.name} · ${birthday.b.label}`,
        to: `/people/${birthday.person.id}`,
      });
    }
    const reminders = peopleUpcomingEvents({
      people,
      gifts,
      promises,
      meetIdeas,
      withinDays: 14,
    }).filter((e) => e.kind !== 'birthday').length;
    if (reminders > 0) {
      facts.push({
        key: 'rem',
        emoji: '🔔',
        text: `${reminders} ${pluralizeRu(reminders, ['напоминание', 'напоминания', 'напоминаний'])} на 2 недели`,
        to: '/people',
      });
    }
    return facts.slice(0, 3);
  }, [expenses, recurring, people, gifts, promises, meetIdeas]);

  const pinnedNotes = useMemo(() => notes.filter((n) => n.pinned).length, [notes]);

  const go = (path: string) => {
    tapLight();
    navigate(path);
  };
  const open = (path: string) => {
    selectionChanged();
    navigate(path);
  };

  // ---- data & backups (hidden behind ⚙) ------------------------------------
  const [dataSheet, setDataSheet] = useState(false);
  const themePref = useThemePref();
  const [isOwner, setIsOwner] = useState(false);
  useEffect(() => {
    let alive = true;
    void getBackupStatus().then((s) => alive && setIsOwner(s.owner));
    return () => {
      alive = false;
    };
  }, []);

  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMsg, setBackupMsg] = useState('');
  const doBackup = async () => {
    setBackupBusy(true);
    setBackupMsg('');
    tapLight();
    const r = await requestTelegramBackup();
    setBackupBusy(false);
    if (r.ok) {
      setBackupMsg('Копия придёт в Telegram в течение минуты ✅');
      notifySuccess();
    } else {
      setBackupMsg('Не получилось запросить копию — попробуйте ещё раз.');
      notifyWarning();
    }
  };

  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingImport, setPendingImport] = useState<File | null>(null);

  const doExport = async () => {
    tapLight();
    const json = JSON.stringify(exportAll(), null, 2);
    const file = new File([json], `coco-data-${new Date().toISOString().slice(0, 10)}.json`, {
      type: 'application/json',
    });
    // In the Telegram in-app browser a normal <a download> just opens the JSON
    // as a page — the native share sheet ("Сохранить в Файлы") is the reliable
    // way to actually get a file out.
    if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Coco — резервная копия' });
        setBackupMsg('Готово — сохраните файл в «Файлы» или отправьте себе.');
        return;
      } catch (err) {
        if ((err as DOMException)?.name === 'AbortError') return; // sheet closed
      }
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    setBackupMsg('Файл с данными сохранён.');
  };

  const runImport = async () => {
    const file = pendingImport;
    setPendingImport(null);
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (importAll(data)) {
        setBackupMsg('Данные импортированы ✅');
        notifySuccess();
      } else {
        setBackupMsg('Это не похоже на файл экспорта Coco.');
        notifyWarning();
      }
    } catch {
      setBackupMsg('Не удалось прочитать файл.');
      notifyWarning();
    }
  };

  if (!hydrated) {
    return (
      <Screen title={greeting()} subtitle="Coco — личный помощник">
        <div className="stack">
          <Skeleton height={92} radius={20} />
          <Skeleton height={44} radius={999} />
          <Skeleton height={148} radius={24} />
          <div className="home-pair">
            <Skeleton height={118} radius={20} />
            <Skeleton height={118} radius={20} />
          </div>
        </div>
      </Screen>
    );
  }

  return (
    <Screen
      title={greeting()}
      subtitle={dateFmt.format(new Date())}
      action={
        <div className="row" style={{ gap: 8 }}>
          <button className="icon-btn" onClick={() => go('/search')} aria-label="Поиск">
            <IconSearch size={20} />
          </button>
          <button
            className="icon-btn"
            onClick={() => {
              tapLight();
              setDataSheet(true);
            }}
            aria-label="Настройки"
          >
            <IconGear size={21} />
          </button>
        </div>
      }
    >
      <div className="stack home-v2">
        {/* Сегодня */}
        {today.length > 0 && (
          <div className="home-today">
            <div className="home-today__label">Сегодня</div>
            {today.map((f) => (
              <button key={f.key} className="home-today__row" onClick={() => open(f.to)}>
                <span className="home-today__emoji" aria-hidden="true">
                  {f.emoji}
                </span>
                <span className="home-today__text">{f.text}</span>
                {f.accent && <span className="home-today__accent">{f.accent}</span>}
                <span className="home-today__chev" aria-hidden="true">
                  ›
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Быстрые действия */}
        <div className="home-quick">
          <button className="home-quick__chip" onClick={() => go('/notes/new')}>
            ✍️ Заметка
          </button>
          <button className="home-quick__chip" onClick={() => go('/finance/expenses/new')}>
            💸 Расход
          </button>
          <button className="home-quick__chip" onClick={() => go('/clothing/lookbook')}>
            🧥 Образы
          </button>
          <button className="home-quick__chip" onClick={() => go('/notes/graph')}>
            🕸 Граф
          </button>
        </div>

        {/* Разделы: финансы — hero, остальные — компактные плитки 2×2 */}
        <div
          className="home-card"
          onClick={() => go('/finance')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              go('/finance');
            }
          }}
          role="button"
          tabIndex={0}
        >
          <div className="home-card__glow" />
          <div className="home-card__icon">
            <IconWallet />
          </div>
          <div className="home-card__body">
            <div className="home-card__title">Финансы</div>
            {fin.has ? (
              <div className="home-card__stats">
                <div className="hc-stat">
                  <div className="hc-stat__num">
                    <AnimatedNumber value={fin.monthly} format={formatRUB} />
                  </div>
                  <div className="hc-stat__lbl">в месяц</div>
                </div>
                <div className="hc-stat">
                  <div className="hc-stat__num">
                    <AnimatedNumber value={fin.remaining} format={formatRUB} />
                  </div>
                  <div className="hc-stat__lbl">осталось выплатить</div>
                </div>
              </div>
            ) : (
              <div className="home-card__desc">Кредиты, рассрочки и накопления</div>
            )}
          </div>
        </div>

        <div className="home-pair">
          <button className="home-tile" onClick={() => go('/notes')}>
            <span className="home-tile__icon">
              <IconNotes />
            </span>
            <span className="home-tile__title">Заметки</span>
            <span className="home-tile__fact">
              {notes.length
                ? `${notes.length} ${pluralizeRu(notes.length, ['заметка', 'заметки', 'заметок'])}${pinnedNotes ? ` · ${pinnedNotes} 📌` : ''}`
                : 'Мысли-чаты со связями'}
            </span>
          </button>
          <button className="home-tile" onClick={() => go('/people')}>
            <span className="home-tile__icon">
              <IconHeart />
            </span>
            <span className="home-tile__title">Люди</span>
            <span className="home-tile__fact">
              {people.length
                ? `${people.length} ${peopleWord(people.length)}`
                : 'Близкие и важные даты'}
            </span>
          </button>
        </div>

        <div className="home-pair">
          <button className="home-tile" onClick={() => go('/clothing')}>
            <span className="home-tile__icon">
              <IconShirt />
            </span>
            <span className="home-tile__title">Гардероб</span>
            <span className="home-tile__fact">
              {wardrobe.length
                ? `${wardrobe.length} ${pluralizeRu(wardrobe.length, ['вещь', 'вещи', 'вещей'])} · ${outfits.length} ${pluralizeRu(outfits.length, ['образ', 'образа', 'образов'])}`
                : 'Вещи, образы и идеи'}
            </span>
          </button>
          <button className="home-tile" onClick={() => go('/calculator')}>
            <span className="home-tile__icon">
              <IconCalculator />
            </span>
            <span className="home-tile__title">Калькулятор</span>
            <span className="home-tile__fact">Инженерный, с жестами</span>
          </button>
        </div>
        <div className="home-version">{versionLabel()}</div>
      </div>

      {dataSheet && (
        <Sheet title="Настройки" onClose={() => setDataSheet(false)}>
          <div className="stack">
            <div className="theme-pick">
              <span className="theme-pick__label">Тема оформления</span>
              <div className="segmented">
                {(['system', 'light', 'dark'] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    className={`segmented__opt${themePref === opt ? ' is-active' : ''}`}
                    onClick={() => {
                      selectionChanged();
                      setThemePref(opt);
                    }}
                  >
                    {opt === 'system' ? 'Система' : opt === 'light' ? 'Светлая' : 'Тёмная'}
                  </button>
                ))}
              </div>
            </div>
            {isOwner && (
              <button
                className="btn btn--primary btn--block"
                type="button"
                onClick={doBackup}
                disabled={backupBusy}
              >
                {backupBusy ? 'Запрашиваю…' : '🗄 Прислать копию в Telegram'}
              </button>
            )}
            <button className="btn btn--ghost btn--block" type="button" onClick={doExport}>
              Экспорт в файл
            </button>
            <button
              className="btn btn--ghost btn--block"
              type="button"
              onClick={() => fileRef.current?.click()}
            >
              Импорт из файла
            </button>
            {backupMsg && <p className="home-backup__msg">{backupMsg}</p>}
            <p className="home-backup__hint">
              {isOwner
                ? 'Копия уходит файлом в чат с ботом (и автоматически раз в день). Экспорт/импорт — файл на устройстве.'
                : 'Экспорт сохраняет все данные в файл; импорт восстанавливает их из файла.'}
            </p>
          </div>
          <input
            ref={fileRef}
            hidden
            type="file"
            accept="application/json,.json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setPendingImport(f);
              e.target.value = '';
            }}
          />
        </Sheet>
      )}

      {pendingImport && (
        <ConfirmDialog
          title="Импортировать данные?"
          message="Импорт заменит ВСЕ текущие данные данными из файла. Это действие необратимо."
          confirmLabel="Заменить и импортировать"
          onClose={() => setPendingImport(null)}
          onConfirm={() => void runImport()}
        />
      )}
    </Screen>
  );
}
