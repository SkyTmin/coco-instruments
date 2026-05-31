import type { IntervalUnit } from '@/types';
import { parseISO } from './date';

const rub = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  maximumFractionDigits: 0,
});

const rubPrecise = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  maximumFractionDigits: 2,
});

/** Format a RUB amount, e.g. 113472 → "113 472 ₽". */
export function formatRUB(value: number, precise = false): string {
  if (!Number.isFinite(value)) return '—';
  return (precise ? rubPrecise : rub).format(value);
}

/** Compact number for chart axes, e.g. 113472 → "113 К". */
export function formatCompact(value: number): string {
  if (Math.abs(value) >= 1000) {
    return `${Math.round(value / 1000)} К`;
  }
  return `${Math.round(value)}`;
}

const dateFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
const dateShortFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });

export function formatDate(iso: string, short = false): string {
  const d = parseISO(iso);
  if (!d) return '—';
  return (short ? dateShortFmt : dateFmt).format(d);
}

/** Russian pluralization: pluralizeRu(2, ['месяц','месяца','месяцев']) → 'месяца'. */
export function pluralizeRu(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(n) % 100;
  const n1 = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (n1 > 1 && n1 < 5) return forms[1];
  if (n1 === 1) return forms[0];
  return forms[2];
}

export function monthsLabel(n: number): string {
  return `${n} ${pluralizeRu(n, ['месяц', 'месяца', 'месяцев'])}`;
}

const DAY_FORMS: [string, string, string] = ['день', 'дня', 'дней'];

/** Human relative day, e.g. "сегодня", "завтра", "через 3 дня", "2 дня назад". */
export function relativeDay(iso: string): string {
  const d = parseISO(iso);
  if (!d) return '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  const days = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (days === 0) return 'сегодня';
  if (days === 1) return 'завтра';
  if (days === 2) return 'послезавтра';
  if (days > 0) return `через ${days} ${pluralizeRu(days, DAY_FORMS)}`;
  if (days === -1) return 'вчера';
  return `${Math.abs(days)} ${pluralizeRu(Math.abs(days), DAY_FORMS)} назад`;
}

const UNIT_FORMS: Record<IntervalUnit, [string, string, string]> = {
  day: ['день', 'дня', 'дней'],
  week: ['неделю', 'недели', 'недель'],
  month: ['месяц', 'месяца', 'месяцев'],
  year: ['год', 'года', 'лет'],
};

const UNIT_EVERY: Record<IntervalUnit, string> = {
  day: 'Каждый день',
  week: 'Каждую неделю',
  month: 'Каждый месяц',
  year: 'Каждый год',
};

/** Human label for a cycle, e.g. (1,'month') → "Каждый месяц", (2,'week') → "Каждые 2 недели". */
export function intervalLabel(count: number, unit: IntervalUnit): string {
  if (count === 1) return UNIT_EVERY[unit];
  return `Каждые ${count} ${pluralizeRu(count, UNIT_FORMS[unit])}`;
}

/** Short label for chips/cards, e.g. (1,'month') → "в месяц", (2,'week') → "2 нед.". */
export function intervalShort(count: number, unit: IntervalUnit): string {
  const short: Record<IntervalUnit, string> = { day: 'дн.', week: 'нед.', month: 'мес.', year: 'г.' };
  if (count === 1) {
    return { day: 'в день', week: 'в неделю', month: 'в месяц', year: 'в год' }[unit];
  }
  return `${count} ${short[unit]}`;
}
