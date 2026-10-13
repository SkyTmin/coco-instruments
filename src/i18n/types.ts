/**
 * Types of the translation catalogs.
 *
 * The Russian catalog (`ru/`) is the source of truth, written `as const`.
 * Every other language is typed with `Translation<typeof ruArea>`: same keys,
 * every leaf a string (or a plural object). A missing or extra key fails `tsc`.
 */

export const LANGS = ['ru', 'en', 'fr', 'tr', 'de', 'es', 'it'] as const;
export type Lang = (typeof LANGS)[number];

/**
 * Plural leaf: forms by `Intl.PluralRules` category. `other` is always
 * required; a language must also have every category its rules produce
 * (ru: one/few/many, en/de/tr: one, fr/es/it: one/many) — checked by the test.
 * The count comes from the `n` param: `t('x.coins', { n: 5 })`.
 */
export interface Plural {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

export type Leaf = string | Plural;

/** A catalog area: nested records ending in strings or plurals. */
export interface Tree {
  readonly [key: string]: Leaf | Tree;
}

/** The shape another language must fill for a Russian area. */
export type Translation<T> = T extends string
  ? string
  : T extends { readonly other: string }
    ? Plural
    : { -readonly [K in keyof T]: Translation<T[K]> };

/** Dotted key paths of a catalog: 'settings.title', 'pets.name.fox'. */
export type Paths<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string | { readonly other: string }
    ? `${P}${K}`
    : Paths<T[K], `${P}${K}.`>;
}[keyof T & string];

/** Values substituted into `{name}` placeholders. Numbers are locale-formatted. */
export type Params = Record<string, string | number>;
