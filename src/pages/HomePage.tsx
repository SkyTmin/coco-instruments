import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatedNumber, Screen, Skeleton } from '@/components/ui';
import { IconHeart, IconNotes, IconShirt, IconWallet } from '@/components/icons';
import { useFinanceStore } from '@/store';
import { collectPayments, computeObligation, computeRecurring } from '@/lib/finance-calc';
import { toISO, todayISO } from '@/lib/date';
import { formatRUB, pluralizeRu, relativeDay } from '@/lib/format';
import { nextBirthday, peopleStats, peopleUpcomingEvents, peopleWord } from '@/lib/people';
import { tapLight } from '@/lib/haptics';

function notesWord(n: number): string {
  const n1 = n % 10;
  const n2 = n % 100;
  if (n1 === 1 && n2 !== 11) return 'заметка';
  if (n1 >= 2 && n1 <= 4 && (n2 < 10 || n2 >= 20)) return 'заметки';
  return 'заметок';
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

  const nearest = useMemo(() => {
    const base = new Date();
    const end = toISO(new Date(base.getFullYear(), base.getMonth() + 3, 0));
    return collectPayments(todayISO(), end, expenses, recurring)[0];
  }, [expenses, recurring]);

  const peopleCard = useMemo(() => {
    const stats = peopleStats({ people, gifts, promises });
    const nearestBirthday = people
      .flatMap((person) => {
        const birthday = nextBirthday(person);
        return birthday ? [{ person, birthday }] : [];
      })
      .sort((a, b) => a.birthday.days - b.birthday.days)[0];
    const reminders = peopleUpcomingEvents({ people, gifts, promises, meetIdeas, withinDays: 14 }).filter(
      (event) => event.kind !== 'birthday',
    ).length;
    return { ...stats, nearestBirthday, reminders };
  }, [gifts, meetIdeas, people, promises]);

  const go = (path: string) => {
    tapLight();
    navigate(path);
  };

  if (!hydrated) {
    return (
      <Screen title="Coco" subtitle="Личный помощник">
        <div className="home-grid">
          <Skeleton height={132} radius={24} />
          <Skeleton height={120} radius={24} />
          <Skeleton height={120} radius={24} />
          <Skeleton height={120} radius={24} />
        </div>
      </Screen>
    );
  }

  return (
    <Screen title="Coco" subtitle="Личный помощник">
      <div className="home-grid">
        <div className="home-card" onClick={() => go('/finance')} role="button">
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
              <div className="home-card__desc">Расходы, кредиты, рассрочки и накопления</div>
            )}
            {fin.has && nearest && (
              <div className="hc-next">
                <span className="hc-next__dot" />
                Ближайший: <b>{nearest.name}</b> · {relativeDay(nearest.date)}
              </div>
            )}
          </div>
        </div>

        <div className="home-card home-card--notes" onClick={() => go('/notes')} role="button">
          <div className="home-card__glow" />
          <div className="home-card__icon">
            <IconNotes />
          </div>
          <div className="home-card__body">
            <div className="home-card__title">Заметки</div>
            <div className="home-card__desc">
              {notes.length ? `${notes.length} ${notesWord(notes.length)}` : 'Связи, теги и граф идей'}
            </div>
          </div>
        </div>

        <div className="home-card home-card--people" onClick={() => go('/people')} role="button">
          <div className="home-card__glow" />
          <div className="home-card__icon">
            <IconHeart />
          </div>
          <div className="home-card__body">
            <div className="home-card__title">Люди</div>
            {people.length ? (
              <>
                <div className="home-card__stats">
                  <div className="hc-stat">
                    <div className="hc-stat__num">{people.length}</div>
                    <div className="hc-stat__lbl">{peopleWord(people.length)}</div>
                  </div>
                  <div className="hc-stat">
                    <div className="hc-stat__num">{peopleCard.reminders}</div>
                    <div className="hc-stat__lbl">напоминаний</div>
                  </div>
                </div>
                {peopleCard.nearestBirthday && (
                  <div className="hc-next">
                    <span className="hc-next__dot" />
                    ДР: <b>{peopleCard.nearestBirthday.person.name}</b> · {peopleCard.nearestBirthday.birthday.label}
                  </div>
                )}
              </>
            ) : (
              <div className="home-card__desc">Близкие, даты и важное</div>
            )}
          </div>
        </div>

        <div className="home-card home-card--clothing" onClick={() => go('/clothing')} role="button">
          <div className="home-card__glow" />
          <div className="home-card__icon">
            <IconShirt />
          </div>
          <div className="home-card__body">
            <div className="home-card__title">Одежда</div>
            <div className="home-card__desc">
              {wardrobe.length
                ? `${wardrobe.length} ${pluralizeRu(wardrobe.length, ['вещь', 'вещи', 'вещей'])} · ${outfits.length} ${pluralizeRu(outfits.length, ['образ', 'образа', 'образов'])}`
                : 'Гардероб, образы и размеры'}
            </div>
          </div>
        </div>
      </div>
    </Screen>
  );
}
