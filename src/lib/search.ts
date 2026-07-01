// ---------------------------------------------------------------------------
// Global search across every section — one query, results from notes, people,
// finance, wardrobe. Pure function over a snapshot of the store; each hit
// carries a deep-link route so the UI can jump straight to the entity.
// ---------------------------------------------------------------------------

import type {
  IncomeSource,
  Note,
  Obligation,
  Outfit,
  Person,
  RecurringPayment,
  SavingsGoal,
  Transaction,
  WardrobeItem,
  WishItem,
} from '@/types';
import { normalizeNoteTitle } from '@/lib/notes-graph';
import { getCategory } from '@/lib/categories';

export type SearchKind =
  | 'note'
  | 'person'
  | 'expense'
  | 'saving'
  | 'recurring'
  | 'transaction'
  | 'income'
  | 'item'
  | 'outfit'
  | 'wish';

export interface SearchResult {
  kind: SearchKind;
  /** Section label + emoji shown as a chip. */
  group: string;
  emoji: string;
  title: string;
  subtitle?: string;
  route: string;
  score: number;
}

/** The slice of store state global search reads. */
export interface SearchIndex {
  notes: Note[];
  people: Person[];
  expenses: Obligation[];
  savings: SavingsGoal[];
  recurring: RecurringPayment[];
  transactions: Transaction[];
  incomeSources: IncomeSource[];
  wardrobe: WardrobeItem[];
  outfits: Outfit[];
  wishlist: WishItem[];
}

const GROUP: Record<SearchKind, { group: string; emoji: string }> = {
  note: { group: 'Заметки', emoji: '📝' },
  person: { group: 'Люди', emoji: '🧑' },
  expense: { group: 'Расходы', emoji: '💳' },
  saving: { group: 'Накопления', emoji: '🎯' },
  recurring: { group: 'Регулярные', emoji: '🔁' },
  transaction: { group: 'Записи', emoji: '🧾' },
  income: { group: 'Доходы', emoji: '💰' },
  item: { group: 'Гардероб', emoji: '👕' },
  outfit: { group: 'Образы', emoji: '🖼' },
  wish: { group: 'Вишлист', emoji: '🛍' },
};

/**
 * Score a set of weighted fields against a normalised query. Title-weighted
 * fields count more; a prefix match beats a mid-string match.
 */
function scoreFields(q: string, fields: { text: string; weight: number }[]): number {
  let score = 0;
  for (const f of fields) {
    const hay = normalizeNoteTitle(f.text || '');
    if (!hay) continue;
    const at = hay.indexOf(q);
    if (at < 0) continue;
    score += f.weight + (at === 0 ? f.weight : 0);
  }
  return score;
}

/**
 * Search everything for `query`. Returns ranked results (best first), capped at
 * `limit`. An empty/short query returns nothing.
 */
export function searchAll(index: SearchIndex, query: string, limit = 40): SearchResult[] {
  const q = normalizeNoteTitle(query);
  if (q.length < 2) return [];
  const out: SearchResult[] = [];
  const push = (
    kind: SearchKind,
    title: string,
    subtitle: string | undefined,
    route: string,
    score: number,
  ) => {
    if (score <= 0) return;
    out.push({ ...GROUP[kind], kind, title, subtitle, route, score });
  };

  for (const n of index.notes) {
    push(
      'note',
      n.title || 'Без названия',
      undefined,
      `/notes/${n.id}`,
      scoreFields(q, [
        { text: n.title, weight: 10 },
        { text: n.body, weight: 2 },
      ]),
    );
  }
  for (const p of index.people) {
    push(
      'person',
      p.name,
      p.city || p.description,
      `/people/${p.id}`,
      scoreFields(q, [
        { text: p.name, weight: 10 },
        { text: p.city || '', weight: 4 },
        { text: (p.tags || []).join(' '), weight: 4 },
        { text: p.description || '', weight: 2 },
      ]),
    );
  }
  for (const o of index.expenses) {
    push(
      'expense',
      o.name,
      o.note,
      `/finance/expenses/${o.id}`,
      scoreFields(q, [
        { text: o.name, weight: 10 },
        { text: o.category || '', weight: 3 },
        { text: o.note || '', weight: 2 },
      ]),
    );
  }
  for (const s of index.savings) {
    push(
      'saving',
      s.name,
      s.note,
      `/finance/savings/${s.id}`,
      scoreFields(q, [
        { text: s.name, weight: 10 },
        { text: s.note || '', weight: 2 },
      ]),
    );
  }
  for (const r of index.recurring) {
    push(
      'recurring',
      r.name,
      r.note,
      `/finance/recurring/${r.id}`,
      scoreFields(q, [
        { text: r.name, weight: 10 },
        { text: r.note || '', weight: 2 },
      ]),
    );
  }
  for (const t of index.transactions) {
    const cat = getCategory(t.category, t.direction).label;
    push(
      'transaction',
      t.note || cat,
      cat,
      `/finance/transactions/${t.id}/edit`,
      scoreFields(q, [
        { text: t.note || '', weight: 8 },
        { text: cat, weight: 6 },
      ]),
    );
  }
  for (const s of index.incomeSources) {
    push(
      'income',
      s.name,
      undefined,
      `/finance/income/${s.id}`,
      scoreFields(q, [{ text: s.name, weight: 10 }]),
    );
  }
  for (const it of index.wardrobe) {
    push(
      'item',
      it.name,
      it.brand,
      `/clothing/wardrobe/${it.id}`,
      scoreFields(q, [
        { text: it.name, weight: 10 },
        { text: it.brand || '', weight: 4 },
        { text: it.note || '', weight: 2 },
      ]),
    );
  }
  for (const o of index.outfits) {
    push(
      'outfit',
      o.name,
      o.note,
      `/clothing/outfits/${o.id}`,
      scoreFields(q, [
        { text: o.name, weight: 10 },
        { text: o.note || '', weight: 2 },
      ]),
    );
  }
  for (const w of index.wishlist) {
    push(
      'wish',
      w.name,
      w.note,
      `/clothing/wishlist`,
      scoreFields(q, [
        { text: w.name, weight: 10 },
        { text: w.note || '', weight: 2 },
      ]),
    );
  }

  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
