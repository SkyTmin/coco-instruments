import { describe, expect, it } from 'vitest';
import { parseGoogle, usableTranslation } from './english-translate';

describe('parseGoogle', () => {
  it('prefers the dictionary block: several senses + part of speech', () => {
    // Shape of translate_a/single?dt=t&dt=bd for "journey".
    const data = [
      [['путешествие', 'journey', null, null, 10]],
      [['noun', ['путешествие', 'поездка', 'путь', 'странствие', 'рейс'], [], 'journey', 1]],
      'en',
    ];
    expect(parseGoogle(data, 'journey')).toEqual({
      translation: 'путешествие, поездка, путь, странствие',
      pos: 'сущ.',
    });
  });

  it('falls back to the plain translation when there is no dictionary block', () => {
    const data = [[['вместо этого', 'instead', null, null, 3]], null, 'en'];
    expect(parseGoogle(data, 'instead')).toEqual({ translation: 'вместо этого' });
  });

  it('returns null for an echo / non-Cyrillic result', () => {
    const data = [[['instead', 'instead', null, null, 0]], null, 'en'];
    expect(parseGoogle(data, 'instead')).toBeNull();
  });

  it('returns null for junk input', () => {
    expect(parseGoogle(null, 'x')).toBeNull();
    expect(parseGoogle('nope', 'x')).toBeNull();
  });
});

describe('usableTranslation', () => {
  it('requires Cyrillic and rejects echoes / warnings', () => {
    expect(usableTranslation('привет', 'hello')).toBe(true);
    expect(usableTranslation('hello', 'hello')).toBe(false);
    expect(usableTranslation('', 'hello')).toBe(false);
    expect(usableTranslation('MYMEMORY WARNING: ...', 'hello')).toBe(false);
  });
});
