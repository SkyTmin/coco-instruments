// Approximate IPA → Russian reading, so an auto-fetched English word can show a
// "Читается — …" line like the curated deck. It is a practical transcription
// (not exact): good enough to sound the word out, with the hand-tuned curated
// deck covering the most common words perfectly. The stressed vowel is
// capitalised (IPA marks primary stress with "ˈ").

const RU_VOWELS = 'аэоуыияеёю';

// Longest IPA keys first so digraphs win over single symbols.
const MAP: ReadonlyArray<readonly [string, string]> = [
  // diphthongs & long vowels
  ['eɪ', 'эй'],
  ['aɪ', 'ай'],
  ['ɔɪ', 'ой'],
  ['oɪ', 'ой'],
  ['aʊ', 'ау'],
  ['oʊ', 'оу'],
  ['əʊ', 'оу'],
  ['ɪə', 'иэ'],
  ['eə', 'эа'],
  ['ɛə', 'эа'],
  ['ʊə', 'уэ'],
  ['juː', 'ю'],
  ['ju', 'ю'],
  ['ɑː', 'а'],
  ['ɔː', 'о'],
  ['iː', 'и'],
  ['uː', 'у'],
  ['ɜː', 'ё'],
  ['ɝ', 'ё'],
  ['ɚ', 'эр'],
  // consonant digraphs
  ['tʃ', 'ч'],
  ['dʒ', 'дж'],
  ['ʃ', 'ш'],
  ['ʒ', 'ж'],
  ['θ', 'с'],
  ['ð', 'з'],
  ['ŋ', 'нг'],
  // single vowels
  ['æ', 'э'],
  ['ʌ', 'а'],
  ['ɒ', 'о'],
  ['ɑ', 'а'],
  ['ɔ', 'о'],
  ['ə', 'э'],
  ['ɛ', 'э'],
  ['e', 'э'],
  ['ɪ', 'и'],
  ['i', 'и'],
  ['ʊ', 'у'],
  ['u', 'у'],
  ['ʉ', 'у'],
  // single consonants
  ['p', 'п'],
  ['b', 'б'],
  ['t', 'т'],
  ['d', 'д'],
  ['k', 'к'],
  ['g', 'г'],
  ['ɡ', 'г'],
  ['f', 'ф'],
  ['v', 'в'],
  ['s', 'с'],
  ['z', 'з'],
  ['m', 'м'],
  ['n', 'н'],
  ['l', 'л'],
  ['r', 'р'],
  ['ɹ', 'р'],
  ['h', 'х'],
  ['w', 'у'],
  ['j', 'й'],
  ['x', 'х'],
];

function capitalizeAt(text: string, index: number): string {
  if (index < 0 || index >= text.length) return text;
  return text.slice(0, index) + text[index].toUpperCase() + text.slice(index + 1);
}

function firstVowelIndex(text: string): number {
  for (let i = 0; i < text.length; i++) if (RU_VOWELS.includes(text[i])) return i;
  return -1;
}

/** Convert an IPA string (e.g. "ˈdʒɜːrni" or "/ˈdʒɜː.ni/") to an approximate
 *  Russian reading with the stressed vowel capitalised (e.g. "джЁрни"). Returns
 *  '' when there's nothing usable to read. */
export function ipaToRussian(input: string): string {
  if (!input) return '';
  // Keep only the first pronunciation variant; drop slashes, brackets, dots.
  const s = input
    .split(',')[0]
    .trim()
    .replace(/[/[\]().]/g, '')
    .replace(/ˌ/g, ''); // secondary stress — ignore

  let out = '';
  let stressNext = false;
  let stressedAt = -1;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === 'ˈ' || ch === "'") {
      stressNext = true;
      i++;
      continue;
    }
    if (ch === 'ː' || ch === ' ' || ch === '-' || ch === '‍') {
      i++;
      continue;
    }
    let key = ch;
    let val = '';
    for (const [k, v] of MAP) {
      if (s.startsWith(k, i)) {
        key = k;
        val = v;
        break;
      }
    }
    if (!val) {
      // Unknown symbol — skip it rather than leaking IPA glyphs.
      i += key.length;
      continue;
    }
    if (stressNext) {
      const vowelOffset = firstVowelIndex(val);
      if (vowelOffset >= 0) {
        stressedAt = out.length + vowelOffset;
        stressNext = false;
      }
    }
    out += val;
    i += key.length;
  }

  if (!out) return '';
  if (stressedAt < 0) stressedAt = firstVowelIndex(out);
  return capitalizeAt(out, stressedAt);
}
