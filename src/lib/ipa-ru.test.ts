import { describe, expect, it } from 'vitest';
import { ipaToRussian } from './ipa-ru';

describe('ipaToRussian', () => {
  it('reads journey with syllables and stress like the core deck', () => {
    expect(ipaToRussian('ˈdʒɜːrni')).toBe('джЁр-ни');
  });

  it('handles slashes, dots and length marks', () => {
    expect(ipaToRussian('/ˈdʒɜːr.ni/')).toBe('джЁр-ни');
  });

  it('keeps onset clusters together (ин-стЭд, not инс-тЭд)', () => {
    expect(ipaToRussian('ɪnˈsted')).toBe('ин-стЭд');
  });

  it('maps digraphs and splits two-vowel words', () => {
    expect(ipaToRussian('ˈbʌtər')).toBe('бА-тэр'); // butter
    expect(ipaToRussian('ˈheloʊ')).toBe('хЭ-лоу'); // hello
  });

  it('leaves single-syllable words lowercase', () => {
    expect(ipaToRussian('kæt')).toBe('кэт');
    expect(ipaToRussian('θɪŋk')).toBe('сингк'); // θ→с, ŋ→нг
  });

  it('returns empty string for empty / unusable input', () => {
    expect(ipaToRussian('')).toBe('');
    expect(ipaToRussian('   ')).toBe('');
  });

  it('never leaks latin / raw IPA glyphs', () => {
    expect(ipaToRussian('ˈbjuːtɪfəl')).not.toMatch(/[a-zɪʊəː]/);
  });
});
