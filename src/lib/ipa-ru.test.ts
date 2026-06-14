import { describe, expect, it } from 'vitest';
import { ipaToRussian } from './ipa-ru';

describe('ipaToRussian', () => {
  it('reads journey with the stressed vowel capitalised', () => {
    expect(ipaToRussian('ˈdʒɜːrni')).toBe('джЁрни');
  });

  it('handles slashes, dots and length marks', () => {
    expect(ipaToRussian('/ˈdʒɜːr.ni/')).toBe('джЁрни');
  });

  it('maps common digraphs', () => {
    expect(ipaToRussian('ˈbʌtər')).toBe('бАтэр'); // butter
    expect(ipaToRussian('θɪŋk')).toBe('сИнгк'); // think → θ→с, ŋ→нг (keeps -ing readable)
  });

  it('capitalises the stressed vowel, not the first, when stress is later', () => {
    const r = ipaToRussian('ɪnˈsted'); // instead
    expect(r).toBe('инстЭд');
  });

  it('falls back to the first vowel when no stress mark is present', () => {
    const r = ipaToRussian('kæt'); // cat
    expect(r).toBe('кЭт');
  });

  it('returns empty string for empty / unusable input', () => {
    expect(ipaToRussian('')).toBe('');
    expect(ipaToRussian('   ')).toBe('');
  });

  it('drops unknown glyphs instead of leaking them', () => {
    expect(ipaToRussian('ˈheloʊ')).not.toMatch(/[a-zɪʊ]/);
  });
});
