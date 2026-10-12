import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { flatten, matchLang, tIn, fmtNum, upper } from './core';
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
  'src/components/AudioToggles.tsx',
  'src/components/BooksTab.tsx',
  'src/components/CashDesk.tsx',
  'src/components/ChestTab.tsx',
  'src/components/CreativePanel.tsx',
  'src/components/Critters.tsx',
  'src/components/DungeonCamp.tsx',
  'src/components/DungeonInventory.tsx',
  'src/components/DungeonMine.tsx',
  'src/components/DungeonRun.tsx',
  'src/components/FishingCamp.tsx',
  'src/components/ForgeScreen.tsx',
  'src/components/Inventory.tsx',
  'src/components/MineField.tsx',
  'src/components/MinePets.tsx',
  'src/components/PetsTab.tsx',
  'src/components/PrisonCamp.tsx',
  'src/components/SessionCard.tsx',
  'src/components/SkinSheet.tsx',
  'src/components/YardBits.tsx',
  'src/components/gx.tsx',
  'src/pages/DungeonPage.tsx',
  'src/pages/FishingPage.tsx',
  'src/pages/ForestPage.tsx',
  'src/pages/GamesPage.tsx',
  'src/pages/PrisonPage.tsx',
  'src/pages/ScatterPage.tsx',
  'src/pages/SlotsPage.tsx',
  'src/pages/YardPage.tsx',
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
