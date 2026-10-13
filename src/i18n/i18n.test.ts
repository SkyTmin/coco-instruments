import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUTO_DETECT, flatten, matchLang, tIn, fmtNum, upper } from './core';
import { ru } from './ru';
import en from './en';
import fr from './fr';
import tr from './tr';
import de from './de';
import es from './es';
import it_ from './it';
import { LOCALE } from './langs';
import { LANGS } from './types';
import type { Lang, Leaf, Plural } from './types';
import { cyrillicLines, hasCyrillic } from './scan';
import { SKINS } from '@/lib/skins';
import { PETS } from '@/lib/pets';
import * as P from '@/lib/prison';
import { PICKS } from '@/lib/economy';
import { RARITIES } from '@/lib/rarity';
import { WIN_TIERS } from '@/lib/rollup';
import { ORB_TIERS } from '@/lib/orb-rarity';
import { PAYLINES } from '@/lib/slots';

const CATALOGS = { en, fr, tr, de, es, it: it_ } as const;

function params(leaf: Leaf): string[] {
  const forms = typeof leaf === 'string' ? [leaf] : Object.values(leaf);
  const set = new Set<string>();
  for (const s of forms) for (const m of s.matchAll(/\{(\w+)\}/g)) set.add(m[1]);
  return [...set].sort();
}

const ruFlat = flatten(ru);

describe('catalogs (a): every language has every key', () => {
  it('ru has no empty strings and full Russian plurals', () => {
    for (const [key, leaf] of ruFlat) {
      if (typeof leaf === 'string') expect(leaf.trim(), key).not.toBe('');
      else
        for (const cat of ['one', 'few', 'many', 'other'] as const)
          expect(leaf[cat], `${key}.${cat}`).toBeTruthy();
    }
  });

  for (const [lang, cat] of Object.entries(CATALOGS) as [Exclude<Lang, 'ru'>, typeof en][]) {
    describe(lang, () => {
      const flat = flatten(cat);
      const need = new Intl.PluralRules(LOCALE[lang]).resolvedOptions().pluralCategories;

      it('same keys as ru', () => {
        expect([...flat.keys()].sort()).toEqual([...ruFlat.keys()].sort());
      });

      it('same {params}, same kind (text/plural), nothing empty, no Cyrillic', () => {
        const bad: string[] = [];
        for (const [key, ruLeaf] of ruFlat) {
          const leaf = flat.get(key);
          if (leaf === undefined) continue;
          if (typeof leaf !== typeof ruLeaf) bad.push(`${key}: plural/text mismatch`);
          if (params(leaf).join() !== params(ruLeaf).join())
            bad.push(`${key}: params ${params(leaf)} ≠ ru ${params(ruLeaf)}`);
          const forms = typeof leaf === 'string' ? [leaf] : Object.values(leaf);
          if (forms.some((s) => !s.trim())) bad.push(`${key}: empty`);
          if (forms.some(hasCyrillic)) bad.push(`${key}: Cyrillic`);
          if (typeof leaf === 'object') {
            for (const c of need)
              if (!(leaf as Plural)[c as keyof Plural]) bad.push(`${key}: no plural «${c}»`);
          }
        }
        expect(bad).toEqual([]);
      });
    });
  }
});

describe('runtime', () => {
  it('plurals and numbers follow the language', () => {
    expect(tIn('ru', 'common.coins', { n: 1 })).toBe('1 монета');
    expect(tIn('ru', 'common.coins', { n: 3 })).toBe('3 монеты');
    expect(tIn('ru', 'common.coins', { n: 25 })).toBe('25 монет');
    expect(fmtNum(12345, 'de')).toBe('12.345');
    expect(fmtNum(12345, 'en')).toBe('12,345');
    // fr: no-break space, not the narrow one the game font can't show
    expect(fmtNum(54321, 'fr')).toBe('54\u00a0321');
  });

  it('Turkish casing keeps the dotted İ', () => {
    expect(upper('kılıç ve iksir', 'tr')).toBe('KILIÇ VE İKSİR');
  });

  it('language codes map to ours, unknown → null', () => {
    expect(matchLang('ru-RU')).toBe('ru');
    expect(matchLang('pt-BR')).toBe(null);
    expect(matchLang('de_AT')).toBe('de');
    expect(matchLang('kk')).toBe('ru');
    expect(LANGS).toHaveLength(7);
  });
});

// ---------------------------------------------------------------------------
// (b) No hard-coded Cyrillic UI text in game files.

const ROOT = join(__dirname, '..', '..');

/** Folders of the game. Every .ts/.tsx inside is scanned, new files included. */
const GAME_DIRS = [
  'src/pages',
  'src/components',
  'src/ui-px',
  'src/game-shell',
  'src/input',
  'src/settings',
];

/**
 * The instruments (finance, notes, people, clothing, calculator) stay Russian
 * by design. FROZEN: a new instrument file is a rare event — add it here
 * only if it truly is not part of the game.
 */
const INSTRUMENTS = new Set([
  'src/pages/CalculatorPage.tsx',
  'src/pages/CameraGalleryPage.tsx',
  'src/pages/CameraPage.tsx',
  'src/pages/ChatNotePage.tsx',
  'src/pages/ChatTagPage.tsx',
  'src/pages/FormulaDetailPage.tsx',
  'src/pages/FormulasPage.tsx',
  'src/pages/HomePage.tsx',
  'src/pages/NoteListDetailPage.tsx',
  'src/pages/NoteListsPage.tsx',
  'src/pages/NotesGraphPage.tsx',
  'src/pages/NotesPage.tsx',
  'src/pages/SearchPage.tsx',
  'src/components/ChatThread.tsx',
  'src/components/CropProvider.tsx',
  'src/components/ErrorBoundary.tsx',
  'src/components/ImageCropper.tsx',
  'src/components/LoginScreen.tsx',
  'src/components/NoteMarkdown.tsx',
  'src/components/NotePicker.tsx',
  'src/components/NotesGuide.tsx',
  'src/components/OutfitCarousel.tsx',
  'src/components/Photo.tsx',
  'src/components/PhotoPicker.tsx',
  'src/components/ShapeDiagram.tsx',
  'src/components/SyncIndicator.tsx',
  'src/components/clothing-cards.tsx',
  'src/components/finance-cards.tsx',
  'src/components/icons.tsx',
  'src/components/ui.tsx',
]);
const INSTRUMENT_DIRS = ['src/pages/clothing/', 'src/pages/finance/', 'src/pages/people/'];

/**
 * Game files NOT yet converted to `t()` (12.10.2026). This list may only
 * SHRINK: convert a file → delete its line. Adding a file here fails the
 * test — new game code is written with `t()` from the start.
 */
const NOT_YET_TRANSLATED = [
  'src/components/CreativePanel.tsx',
  'src/components/DungeonCamp.tsx',
  'src/components/DungeonInventory.tsx',
  'src/components/DungeonMine.tsx',
  'src/components/DungeonRun.tsx',
  'src/components/FishingCamp.tsx',
  'src/components/Inventory.tsx',
  'src/pages/DungeonPage.tsx',
  'src/pages/FishingPage.tsx',
  'src/pages/ForestPage.tsx',
];
/** The list as it was on 12.10.2026 — never extend, only the list above shrinks. */
const ORIGINAL_COUNT = 29;

function walk(dir: string): string[] {
  if (!existsSync(join(ROOT, dir))) return [];
  return readdirSync(join(ROOT, dir)).flatMap((f) => {
    const p = `${dir}/${f}`;
    if (statSync(join(ROOT, p)).isDirectory()) return walk(p);
    return /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
  });
}

function isInstrument(f: string): boolean {
  return INSTRUMENTS.has(f) || INSTRUMENT_DIRS.some((d) => f.startsWith(d));
}

describe('game files (b): no hard-coded Cyrillic text', () => {
  const files = GAME_DIRS.flatMap(walk).filter((f) => !isInstrument(f));

  it('auto-detect waits for the whole game to be translated', () => {
    // A non-Russian Telegram must not get a half-Russian game.
    expect(AUTO_DETECT && NOT_YET_TRANSLATED.length > 0).toBe(false);
  });

  it('the not-yet-translated list only shrinks', () => {
    expect(NOT_YET_TRANSLATED.length).toBeLessThanOrEqual(ORIGINAL_COUNT);
    expect(new Set(NOT_YET_TRANSLATED).size).toBe(NOT_YET_TRANSLATED.length);
  });

  it('listed files still need translation (converted → remove from the list)', () => {
    const done = NOT_YET_TRANSLATED.filter(
      (f) =>
        !existsSync(join(ROOT, f)) || !cyrillicLines(readFileSync(join(ROOT, f), 'utf8')).length,
    );
    expect(done).toEqual([]);
  });

  it('every other game file goes through t()', () => {
    const bad: string[] = [];
    for (const f of files) {
      if (NOT_YET_TRANSLATED.includes(f)) continue;
      const hits = cyrillicLines(readFileSync(join(ROOT, f), 'utf8'));
      if (hits.length) bad.push(`${f}\n  ${hits.slice(0, 5).join('\n  ')}`);
    }
    expect(
      bad,
      'Move these texts to src/i18n/ru + all 6 languages (see .claude/rules/i18n.md)',
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Data names: every id of the game data has its catalog entry, and the Russian
// catalog matches the Russian text in src/lib (change one — change both, and
// the six translations with them).

describe('data areas match src/lib', () => {
  it('skins', () => {
    for (const s of SKINS) {
      const c = ru.skins[s.id];
      expect(c, s.id).toBeTruthy();
      expect([c.name, c.hint, c.title, c.subtitle]).toEqual([s.name, s.hint, s.title, s.subtitle]);
    }
    expect(Object.keys(ru.skins).sort()).toEqual(SKINS.map((s) => s.id).sort());
  });

  it('slots (win steps, orb tiers, paylines)', () => {
    const by = <T extends { id: string | number }>(
      a: T[],
      key: (x: T) => string,
      f: (x: T) => string,
    ) => Object.fromEntries(a.map((x) => [key(x), f(x)]));
    expect(ru.slots.step).toEqual(
      by(
        WIN_TIERS,
        (w) => w.id,
        (w) => w.name,
      ),
    );
    expect(ru.slots.orb).toEqual(
      by(
        ORB_TIERS,
        (o) => o.id,
        (o) => o.name,
      ),
    );
    expect(ru.slots.line).toEqual(
      by(
        PAYLINES,
        (l) => `l${l.id}`,
        (l) => l.name,
      ),
    );
    expect(ru.slots.lineIn).toEqual(
      by(
        PAYLINES,
        (l) => `l${l.id}`,
        (l) => l.name.toLowerCase(),
      ),
    );
  });

  it('pets', () => {
    for (const p of PETS) {
      const c = ru.pets[p.id];
      expect(c, p.id).toBeTruthy();
      expect([c.name, c.lore]).toEqual([p.name, p.lore]);
    }
    expect(Object.keys(ru.pets).sort()).toEqual(PETS.map((p) => p.id).sort());
  });

  it('mine (rocks, picks, rarities, enchants, items, runes, streak, chests, crew, perks, horizons)', () => {
    const ix = (a: string[]) => Object.fromEntries(a.map((v, i) => [String(i), v]));
    const by = <T extends { id: string }>(a: T[], f: (x: T) => unknown) =>
      Object.fromEntries(a.map((x) => [x.id, f(x)]));
    expect(ru.mine).toEqual({
      rock: ix(P.ROCKS.map((r) => r.name)),
      block: ix(P.ROCKS.map((r) => r.blockName)),
      pick: ix(PICKS.map((p) => p.name)),
      rarity: by(RARITIES, (r) => r.name),
      enchant: by(P.ENCHANTS, (e) => e.name),
      item: by(P.ITEMS, (i) => ({ name: i.name, text: i.text })),
      rune: by(P.RUNES, (r) => ({ name: r.name, text: r.text })),
      streak: ix(P.STREAK_TIERS.map((s) => s.name)),
      chest: by(P.CASE_TIERS, (c) => c.name),
      crew: by(P.CREW_SHIFTS, (c) => ({ name: c.name, text: c.text })),
      perk: by(P.PERKS, (p) => ({ name: p.name, per: p.per })),
      horizon: ix(P.HORIZONS.map((h) => h.name)),
    });
  });
});
