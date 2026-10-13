/**
 * Finds hard-coded Cyrillic UI text in source code, ignoring comments.
 * Used by `i18n.test.ts` (guard «no untranslated text in game files»).
 *
 * A small tokenizer: tracks '…', "…", `…` strings and //, /* *\/ comments
 * (JSX `{/* *\/}` included). A line with the marker `i18n-ignore` is skipped
 * — for the rare Cyrillic that is data, not UI (e.g. parsing Russian input).
 */
const CYR = /[Ѐ-ӿ]/;

/** Source with comments blanked out; line breaks kept so line numbers match. */
export function stripComments(src: string): string {
  let out = '';
  let i = 0;
  let str: '"' | "'" | '`' | null = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (str) {
      out += c;
      if (c === '\\') {
        out += n ?? '';
        i += 2;
        continue;
      }
      if (c === str || (c === '\n' && str !== '`')) str = null;
      i++;
      continue;
    }
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && n === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') out += '\n';
        i++;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') str = c;
    out += c;
    i++;
  }
  return out;
}

/** Lines (1-based) with Cyrillic outside comments, as `line: text`. */
export function cyrillicLines(src: string): string[] {
  const raw = src.split('\n');
  const code = stripComments(src).split('\n');
  const hits: string[] = [];
  code.forEach((line, i) => {
    if (!CYR.test(line)) return;
    if (raw[i]?.includes('i18n-ignore')) return;
    hits.push(`${i + 1}: ${line.trim().slice(0, 80)}`);
  });
  return hits;
}

export function hasCyrillic(s: string): boolean {
  return CYR.test(s);
}
