// A tiny, dependency-free Markdown parser tuned for Coco notes.
// Outputs a typed block/inline tree that <NoteMarkdown> renders with React
// elements (never dangerouslySetInnerHTML), so user text is always escaped.
// Supports: #/##/### headings, **bold**, *italic*, `code`, ~~strike~~,
// [[wiki|alias#sec]] links, #tags, [label](url) links, ![alt](src) images,
// - bullets, 1. ordered, - [ ] tasks, > quotes, ``` fences, --- rules.

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'br' }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'del'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'wiki'; target: string; alias?: string; section?: string }
  | { t: 'tag'; v: string }
  | { t: 'link'; href: string; label: string }
  | { t: 'image'; src: string; alt: string };

export type Block =
  | { t: 'h'; level: 1 | 2 | 3; c: Inline[] }
  | { t: 'p'; c: Inline[] }
  | { t: 'ul'; items: Inline[][] }
  | { t: 'ol'; items: Inline[][] }
  | { t: 'tasks'; items: { checked: boolean; index: number; c: Inline[] }[] }
  | { t: 'quote'; c: Inline[] }
  | { t: 'code'; v: string; lang?: string }
  | { t: 'img'; src: string; alt: string }
  | { t: 'hr' };

const HEADING_RE = /^(#{1,3})\s+(.*)$/;
const IMG_LINE_RE = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/;
const HR_RE = /^\s*([-*_])\1{2,}\s*$/;
const QUOTE_RE = /^>\s?(.*)$/;
const TASK_RE = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/;
const UL_RE = /^\s*[-*]\s+(.*)$/;
const OL_RE = /^\s*\d+\.\s+(.*)$/;
const FENCE_RE = /^```(.*)$/;
const TAG_SPLIT_RE = /(^|[^#\p{L}\p{N}_-])#([\p{L}\p{N}_][\p{L}\p{N}_-]{0,31})/gu;

const SAFE_LINK = /^(https?:|mailto:|tel:)/i;
const SAFE_IMG = /^(https?:|data:image\/|blob:|attachment:)/i;

/** Restrict hrefs so a [label](javascript:…) can never produce a live link. */
export function safeHref(href: string): string | undefined {
  return SAFE_LINK.test(href.trim()) ? href.trim() : undefined;
}
export function safeImageSrc(src: string): string | undefined {
  return SAFE_IMG.test(src.trim()) ? src.trim() : undefined;
}

// ---- inline -----------------------------------------------------------------

interface TokenMatch {
  index: number;
  length: number;
  node: Inline;
}

function firstOf(text: string, ...res: { re: RegExp; make: (m: RegExpExecArray) => Inline }[]): TokenMatch | null {
  let best: TokenMatch | null = null;
  for (const { re, make } of res) {
    re.lastIndex = 0;
    const m = re.exec(text);
    if (m && (best === null || m.index < best.index)) {
      best = { index: m.index, length: m[0].length, node: make(m) };
    }
  }
  return best;
}

function parseWiki(inner: string): Inline {
  const [lhs, alias] = inner.split('|');
  const [target, section] = lhs.split('#');
  return {
    t: 'wiki',
    target: target.trim(),
    alias: alias?.trim() || undefined,
    section: section?.trim() || undefined,
  };
}

/** Split a plain run into text + #tag inlines (tags only after a boundary). */
function splitTags(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  TAG_SPLIT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_SPLIT_RE.exec(text))) {
    const lead = m[1];
    const start = m.index + lead.length; // position of '#'
    if (start > last) out.push({ t: 'text', v: text.slice(last, start) });
    out.push({ t: 'tag', v: m[2] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ t: 'text', v: text.slice(last) });
  return out;
}

function pushText(out: Inline[], text: string) {
  for (const node of splitTags(text)) {
    if (node.t === 'text' && !node.v) continue;
    out.push(node);
  }
}

/** Tokenize one line of inline markdown (no line breaks inside). */
export function parseInline(input: string): Inline[] {
  const out: Inline[] = [];
  let rest = input;
  let guard = 0;
  while (rest && guard++ < 5000) {
    const m = firstOf(
      rest,
      { re: /`([^`\n]+)`/, make: (x) => ({ t: 'code', v: x[1] }) },
      { re: /!\[([^\]\n]*)\]\(([^)\s\n]+)\)/, make: (x) => ({ t: 'image', src: x[2], alt: x[1] }) },
      { re: /\[\[([^\]\n]+?)\]\]/, make: (x) => parseWiki(x[1]) },
      { re: /\[([^\]\n]+)\]\(([^)\s\n]+)\)/, make: (x) => ({ t: 'link', label: x[1], href: x[2] }) },
      { re: /\*\*([^\n]+?)\*\*/, make: (x) => ({ t: 'strong', c: parseInline(x[1]) }) },
      { re: /__([^\n]+?)__/, make: (x) => ({ t: 'strong', c: parseInline(x[1]) }) },
      { re: /~~([^\n]+?)~~/, make: (x) => ({ t: 'del', c: parseInline(x[1]) }) },
      { re: /\*([^*\n]+?)\*/, make: (x) => ({ t: 'em', c: parseInline(x[1]) }) },
    );
    if (!m) {
      pushText(out, rest);
      break;
    }
    if (m.index > 0) pushText(out, rest.slice(0, m.index));
    out.push(m.node);
    rest = rest.slice(m.index + m.length);
  }
  return out;
}

/** Inline content for a multi-line block: lines joined by <br/>. */
function parseInlineMultiline(lines: string[]): Inline[] {
  const out: Inline[] = [];
  lines.forEach((line, i) => {
    if (i > 0) out.push({ t: 'br' });
    out.push(...parseInline(line));
  });
  return out;
}

// ---- blocks -----------------------------------------------------------------

export function parseBlocks(body: string): Block[] {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  let taskCounter = 0;

  const flushPara = () => {
    if (!para.length) return;
    blocks.push({ t: 'p', c: parseInlineMultiline(para) });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (FENCE_RE.test(line)) {
      flushPara();
      const lang = (FENCE_RE.exec(line)?.[1] || '').trim() || undefined;
      const buf: string[] = [];
      i++;
      while (i < lines.length && !FENCE_RE.test(lines[i])) buf.push(lines[i++]);
      blocks.push({ t: 'code', v: buf.join('\n'), lang });
      continue;
    }

    if (!line.trim()) {
      flushPara();
      continue;
    }

    const img = IMG_LINE_RE.exec(line);
    if (img) {
      flushPara();
      blocks.push({ t: 'img', alt: img[1], src: img[2] });
      continue;
    }

    if (HR_RE.test(line)) {
      flushPara();
      blocks.push({ t: 'hr' });
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushPara();
      blocks.push({ t: 'h', level: heading[1].length as 1 | 2 | 3, c: parseInline(heading[2]) });
      continue;
    }

    if (QUOTE_RE.test(line)) {
      flushPara();
      const buf: string[] = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) buf.push(QUOTE_RE.exec(lines[i++])![1]);
      i--;
      blocks.push({ t: 'quote', c: parseInlineMultiline(buf) });
      continue;
    }

    if (TASK_RE.test(line)) {
      flushPara();
      const items: { checked: boolean; index: number; c: Inline[] }[] = [];
      while (i < lines.length) {
        const m = TASK_RE.exec(lines[i]);
        if (!m) break;
        items.push({ checked: m[1] !== ' ', index: taskCounter++, c: parseInline(m[2]) });
        i++;
      }
      i--;
      blocks.push({ t: 'tasks', items });
      continue;
    }

    if (UL_RE.test(line)) {
      flushPara();
      const items: Inline[][] = [];
      while (i < lines.length && UL_RE.test(lines[i]) && !TASK_RE.test(lines[i])) {
        items.push(parseInline(UL_RE.exec(lines[i++])![1]));
      }
      i--;
      blocks.push({ t: 'ul', items });
      continue;
    }

    if (OL_RE.test(line)) {
      flushPara();
      const items: Inline[][] = [];
      while (i < lines.length && OL_RE.test(lines[i])) {
        items.push(parseInline(OL_RE.exec(lines[i++])![1]));
      }
      i--;
      blocks.push({ t: 'ol', items });
      continue;
    }

    para.push(line);
  }
  flushPara();
  return blocks;
}

/** Total number of task checkboxes, so a toggle can address the Nth one. */
export function countTasks(body: string): number {
  let n = 0;
  for (const line of body.split('\n')) if (TASK_RE.test(line)) n++;
  return n;
}

/** Flip the checkbox state of the `index`-th task line in the body. */
export function toggleTaskInBody(body: string, index: number): string {
  let seen = -1;
  return body
    .split('\n')
    .map((line) => {
      if (!TASK_RE.test(line)) return line;
      seen++;
      if (seen !== index) return line;
      return line.replace(/\[([ xX])\]/, (_, mark: string) => (mark === ' ' ? '[x]' : '[ ]'));
    })
    .join('\n');
}

/** One-line, marker-free preview of a note body for the list. */
export function noteExcerpt(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[\[([^\][|#]+)(?:#[^\][|]+)?(?:\|([^\][]+))?\]\]/g, (_, t, a) => a || t)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*[-*]\s+\[[ xX]\]\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/^\s*#{1,3}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/(\*\*|__|~~|`|\*)/g, '')
    .replace(/(^|[^#\p{L}\p{N}_-])#[\p{L}\p{N}_][\p{L}\p{N}_-]{0,31}/gu, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
