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
