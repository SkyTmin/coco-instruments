// ---------------------------------------------------------------------------
// Catalog of spending / income categories for the cashflow ledger.
// Kept small and Russian-first; ids are stable strings stored on Transaction.
// ---------------------------------------------------------------------------

import type { TxDirection } from '@/types';

export interface Category {
  id: string;
  label: string;
  emoji: string;
  /** Chart/pill colour (hex). */
  color: string;
}

/** Where money goes. Order = display order in pickers and charts. */
export const EXPENSE_CATEGORIES: Category[] = [
  { id: 'food', label: 'Еда и продукты', emoji: '🍔', color: '#E8663A' },
  { id: 'transport', label: 'Транспорт', emoji: '🚌', color: '#3A86E8' },
  { id: 'home', label: 'Дом и жильё', emoji: '🏠', color: '#7B4B2A' },
  { id: 'health', label: 'Здоровье', emoji: '💊', color: '#E83A6B' },
  { id: 'clothes', label: 'Одежда', emoji: '👕', color: '#9B5DE5' },
  { id: 'fun', label: 'Развлечения', emoji: '🎬', color: '#F15BB5' },
  { id: 'cafe', label: 'Кафе и рестораны', emoji: '☕', color: '#C1662A' },
  { id: 'gifts', label: 'Подарки', emoji: '🎁', color: '#E8B53A' },
  { id: 'services', label: 'Услуги и связь', emoji: '📱', color: '#00BBF9' },
  { id: 'education', label: 'Образование', emoji: '📚', color: '#2AA98C' },
  { id: 'pets', label: 'Питомцы', emoji: '🐾', color: '#8A6D3B' },
  { id: 'other', label: 'Другое', emoji: '💸', color: '#8A8A8E' },
];

/** Where money comes from. */
export const INCOME_CATEGORIES: Category[] = [
  { id: 'salary', label: 'Зарплата', emoji: '💰', color: '#2AA98C' },
  { id: 'advance', label: 'Аванс', emoji: '💵', color: '#3AB57A' },
  { id: 'bonus', label: 'Премия', emoji: '🏆', color: '#E8B53A' },
  { id: 'freelance', label: 'Подработка', emoji: '🛠', color: '#3A86E8' },
  { id: 'sale', label: 'Продажа', emoji: '🏷', color: '#9B5DE5' },
  { id: 'gift', label: 'Подарок', emoji: '🎁', color: '#F15BB5' },
  { id: 'rent', label: 'Аренда', emoji: '🏢', color: '#7B4B2A' },
  { id: 'other', label: 'Другое', emoji: '➕', color: '#8A8A8E' },
];

const FALLBACK: Category = { id: 'other', label: 'Другое', emoji: '💸', color: '#8A8A8E' };

export function categoriesFor(direction: TxDirection): Category[] {
  return direction === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
}

/** Look up a category by id (searches both lists); never throws. */
export function getCategory(id: string, direction?: TxDirection): Category {
  const lists = direction ? [categoriesFor(direction)] : [EXPENSE_CATEGORIES, INCOME_CATEGORIES];
  for (const list of lists) {
    const hit = list.find((c) => c.id === id);
    if (hit) return hit;
  }
  return FALLBACK;
}
