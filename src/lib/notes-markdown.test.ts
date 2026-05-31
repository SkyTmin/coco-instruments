import { describe, expect, it } from 'vitest';
import {
  countTasks,
  noteExcerpt,
  parseBlocks,
  parseInline,
  safeHref,
  safeImageSrc,
  toggleTaskInBody,
} from './notes-markdown';

describe('parseInline', () => {
  it('keeps plain text intact', () => {
    expect(parseInline('hello world')).toEqual([{ t: 'text', v: 'hello world' }]);
  });

  it('parses bold, italic, code and strike', () => {
    expect(parseInline('**a**')).toEqual([{ t: 'strong', c: [{ t: 'text', v: 'a' }] }]);
    expect(parseInline('*a*')).toEqual([{ t: 'em', c: [{ t: 'text', v: 'a' }] }]);
    expect(parseInline('`a`')).toEqual([{ t: 'code', v: 'a' }]);
    expect(parseInline('~~a~~')).toEqual([{ t: 'del', c: [{ t: 'text', v: 'a' }] }]);
  });

  it('prefers bold over italic for **', () => {
    const out = parseInline('**bold** and *it*');
    expect(out[0]).toEqual({ t: 'strong', c: [{ t: 'text', v: 'bold' }] });
    expect(out).toContainEqual({ t: 'em', c: [{ t: 'text', v: 'it' }] });
  });

  it('parses wiki links with alias and section', () => {
    expect(parseInline('[[Проект]]')).toEqual([{ t: 'wiki', target: 'Проект' }]);
    expect(parseInline('[[Проект|см.]]')).toEqual([{ t: 'wiki', target: 'Проект', alias: 'см.' }]);
    expect(parseInline('[[Проект#Итоги]]')).toEqual([
      { t: 'wiki', target: 'Проект', section: 'Итоги' },
    ]);
  });

  it('parses tags only after a boundary, not inside words', () => {
    expect(parseInline('тут #идея да')).toContainEqual({ t: 'tag', v: 'идея' });
    expect(parseInline('color#fff')).toEqual([{ t: 'text', v: 'color#fff' }]);
  });

  it('parses external links and inline images', () => {
    expect(parseInline('[ya](https://ya.ru)')).toEqual([
      { t: 'link', label: 'ya', href: 'https://ya.ru' },
    ]);
    expect(parseInline('![pic](attachment:1)')).toEqual([
      { t: 'image', src: 'attachment:1', alt: 'pic' },
    ]);
  });

  it('does not treat an image as a link', () => {
    const out = parseInline('see ![p](attachment:9) end');
    expect(out).toContainEqual({ t: 'image', src: 'attachment:9', alt: 'p' });
    expect(out.some((n) => n.t === 'link')).toBe(false);
  });
});

describe('parseBlocks', () => {
  it('splits headings, paragraphs and rules', () => {
    const blocks = parseBlocks('# Title\n\nbody line\n\n---');
    expect(blocks[0]).toMatchObject({ t: 'h', level: 1 });
    expect(blocks[1]).toMatchObject({ t: 'p' });
    expect(blocks[2]).toEqual({ t: 'hr' });
  });

  it('groups consecutive bullet items into one list', () => {
    const blocks = parseBlocks('- a\n- b\n- c');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ t: 'ul' });
    expect((blocks[0] as { items: unknown[] }).items).toHaveLength(3);
  });

  it('numbers task indices across the whole note', () => {
    const blocks = parseBlocks('- [ ] one\n- [x] two\n\ntext\n\n- [ ] three');
    const tasks = blocks.filter((b) => b.t === 'tasks') as Extract<
      ReturnType<typeof parseBlocks>[number],
      { t: 'tasks' }
    >[];
    expect(tasks).toHaveLength(2);
    expect(tasks[0].items[0]).toMatchObject({ checked: false, index: 0 });
    expect(tasks[0].items[1]).toMatchObject({ checked: true, index: 1 });
    expect(tasks[1].items[0]).toMatchObject({ checked: false, index: 2 });
  });

  it('keeps fenced code verbatim', () => {
    const blocks = parseBlocks('```js\nconst a = 1;\n```');
    expect(blocks[0]).toEqual({ t: 'code', v: 'const a = 1;', lang: 'js' });
  });

  it('renders a lone image line as an image block', () => {
    const blocks = parseBlocks('![pic](https://x/y.png)');
    expect(blocks[0]).toEqual({ t: 'img', alt: 'pic', src: 'https://x/y.png' });
  });

  it('merges consecutive quote lines', () => {
    const blocks = parseBlocks('> a\n> b');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ t: 'quote' });
  });
});

describe('tasks', () => {
  it('counts every checkbox', () => {
    expect(countTasks('- [ ] a\n- [x] b\nplain\n- [ ] c')).toBe(3);
  });

  it('toggles only the addressed checkbox', () => {
    const body = '- [ ] a\n- [ ] b';
    expect(toggleTaskInBody(body, 1)).toBe('- [ ] a\n- [x] b');
    expect(toggleTaskInBody('- [x] a', 0)).toBe('- [ ] a');
  });
});

describe('safety', () => {
  it('allows http/mailto links, rejects javascript', () => {
    expect(safeHref('https://ya.ru')).toBe('https://ya.ru');
    expect(safeHref('mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(safeHref('javascript:alert(1)')).toBeUndefined();
  });

  it('allows data/attachment images, rejects javascript', () => {
    expect(safeImageSrc('attachment:1')).toBe('attachment:1');
    expect(safeImageSrc('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    expect(safeImageSrc('javascript:alert(1)')).toBeUndefined();
  });
});

describe('noteExcerpt', () => {
  it('strips markdown noise to a clean preview', () => {
    expect(noteExcerpt('# Title\n\n**bold** and [[Link|alias]] #tag done')).toBe(
      'Title bold and alias done',
    );
  });

  it('drops images and code fences', () => {
    expect(noteExcerpt('text\n![p](attachment:1)\n```\ncode\n```')).toBe('text');
  });
});
