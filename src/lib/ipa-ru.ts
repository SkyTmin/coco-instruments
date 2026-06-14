// IPA → Russian practical transcription. It tokenises IPA into phonemes,
// splits them into syllables (one coda consonant, the rest onset — so clusters
// like "st" stay together: ин-стЭд), maps each phoneme to Russian, joins
// syllables with "-", and capitalises the stressed syllable's vowel — matching
// the hand-tuned core deck ("джЁр-ни"). It is an approximation: good enough to
// sound a word out, with the curated core covering the common words perfectly.

interface Phone {
  ru: string;
  vowel: boolean;
}

// [ipaKey, russian, isVowel] — longest keys first so digraphs win over singles.
const TABLE: ReadonlyArray<readonly [string, string, boolean]> = [
  // diphthongs & long vowels
  ['juː', 'ю', true],
  ['eɪ', 'эй', true],
  ['aɪ', 'ай', true],
  ['ɔɪ', 'ой', true],
  ['oɪ', 'ой', true],
  ['aʊ', 'ау', true],
  ['oʊ', 'оу', true],
  ['əʊ', 'оу', true],
  ['ɪə', 'иэ', true],
  ['eə', 'эа', true],
  ['ɛə', 'эа', true],
  ['ʊə', 'уэ', true],
  ['ju', 'ю', true],
  ['ɑː', 'а', true],
  ['ɔː', 'о', true],
  ['iː', 'и', true],
  ['uː', 'у', true],
  ['ɜː', 'ё', true],
  ['əː', 'ё', true],
  ['ɝ', 'ёр', true],
  ['ɚ', 'эр', true],
  // consonant digraphs
  ['tʃ', 'ч', false],
  ['dʒ', 'дж', false],
  ['ʃ', 'ш', false],
  ['ʒ', 'ж', false],
  ['θ', 'с', false],
  ['ð', 'з', false],
  ['ŋ', 'нг', false],
  // single vowels
  ['æ', 'э', true],
  ['ʌ', 'а', true],
  ['ɒ', 'о', true],
  ['ɑ', 'а', true],
  ['ɔ', 'о', true],
  ['ə', 'э', true],
  ['ɛ', 'э', true],
  ['e', 'э', true],
  ['ɪ', 'и', true],
  ['i', 'и', true],
  ['ʊ', 'у', true],
  ['u', 'у', true],
  ['ʉ', 'у', true],
  ['ɜ', 'ё', true],
  ['o', 'о', true],
  ['a', 'а', true],
  // single consonants
  ['p', 'п', false],
  ['b', 'б', false],
  ['t', 'т', false],
  ['d', 'д', false],
  ['k', 'к', false],
  ['g', 'г', false],
  ['ɡ', 'г', false],
  ['f', 'ф', false],
  ['v', 'в', false],
  ['s', 'с', false],
  ['z', 'з', false],
  ['m', 'м', false],
  ['n', 'н', false],
  ['l', 'л', false],
  ['r', 'р', false],
  ['ɹ', 'р', false],
  ['h', 'х', false],
  ['w', 'у', false],
  ['j', 'й', false],
  ['x', 'х', false],
];

function tokenize(ipa: string): { phones: Phone[]; stress: number } {
  const phones: Phone[] = [];
  let stress = -1;
  let stressNext = false;
  let i = 0;
  while (i < ipa.length) {
    const c = ipa[i];
    if (c === 'ˈ' || c === "'") {
      stressNext = true;
      i++;
      continue;
    }
    if (c === 'ˌ' || c === 'ː' || c === ' ' || c === '-' || c === '.') {
      i++;
      continue;
    }
    let hit: readonly [string, string, boolean] | null = null;
    for (const e of TABLE) {
      if (ipa.startsWith(e[0], i)) {
        hit = e;
        break;
      }
    }
    if (!hit) {
      i++; // unknown glyph — skip rather than leak it
      continue;
    }
    if (stressNext && hit[2]) {
      stress = phones.length;
      stressNext = false;
    }
    phones.push({ ru: hit[1], vowel: hit[2] });
    i += hit[0].length;
  }
  return { phones, stress };
}

/** Cut points (start index of each syllable after the first). One consonant
 *  stays as the coda of the previous syllable, the rest open the next. */
function syllableCuts(phones: Phone[]): number[] {
  const vowels: number[] = [];
  phones.forEach((p, i) => p.vowel && vowels.push(i));
  const cuts: number[] = [];
  for (let k = 0; k < vowels.length - 1; k++) {
    const v = vowels[k];
    const nextV = vowels[k + 1];
    const between = nextV - v - 1;
    cuts.push(between >= 2 ? v + 2 : v + 1);
  }
  return cuts;
}

const capFirst = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Convert an IPA string (e.g. "ˈdʒɜːrni" / "/ˈdʒɜː.ni/") to an approximate,
 *  syllable-hyphenated Russian reading with the stressed vowel capitalised
 *  ("джЁр-ни"). Returns '' when there's nothing usable. */
export function ipaToRussian(input: string): string {
  if (!input) return '';
  const ipa = input
    .split(',')[0]
    .trim()
    .replace(/[/[\]()]/g, '');
  const { phones, stress: rawStress } = tokenize(ipa);
  if (!phones.length) return '';
  let stress = rawStress;

  const vowelCount = phones.filter((p) => p.vowel).length;
  // No explicit stress: mark the first vowel — but only for polysyllables
  // (single-syllable words read fine without a capital, like the core's "зоу").
  if (stress < 0 && vowelCount > 1) stress = phones.findIndex((p) => p.vowel);

  const pieces = phones.map((p, i) => (i === stress ? capFirst(p.ru) : p.ru));
  const cuts = syllableCuts(phones);
  const out: string[] = [];
  let start = 0;
  for (const cut of [...cuts, phones.length]) {
    out.push(pieces.slice(start, cut).join(''));
    start = cut;
  }
  return out.filter(Boolean).join('-');
}
