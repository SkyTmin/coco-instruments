// Clothing size calculator — measurements → sizes. Outerwear / shirt / pants
// formulas are ported from the legacy app (legacy/js/clothing-size.js); shoe
// conversions are replaced with standard ones (the legacy EU formula was off).

export type Gender = 'male' | 'female';

export interface SizeField {
  key: string;
  label: string;
  unit: string;
  placeholder?: string;
}

export interface SizeResult {
  label: string;
  value: string;
}

export interface SizeCategoryDef {
  id: 'outerwear' | 'shirt' | 'pants' | 'shoes';
  label: string;
  emoji: string;
  /** First field is required; the rest are optional refinements. */
  fields: SizeField[];
  usesGender?: boolean;
  recordLabel: string;
  compute: (v: Record<string, number>, gender: Gender) => SizeResult[];
}

/** International size by chest (cm) — outerwear ranges from the legacy app. */
export function outerwearInt(chest: number): string {
  if (chest >= 86 && chest < 94) return 'S';
  if (chest >= 94 && chest < 102) return 'M';
  if (chest >= 102 && chest < 110) return 'L';
  if (chest >= 110 && chest < 118) return 'XL';
  if (chest >= 118 && chest < 126) return 'XXL';
  return chest < 86 ? 'XS' : 'XXXL';
}

/** International size by chest (cm) — shirt ranges from the legacy app. */
export function shirtInt(chest: number): string {
  const half = chest / 2;
  if (half >= 46 && half < 50) return 'S';
  if (half >= 50 && half < 52) return 'M';
  if (half >= 52 && half < 54) return 'L';
  if (half >= 54 && half < 56) return 'XL';
  if (half >= 56 && half < 58) return 'XXL';
  return half < 46 ? 'XS' : 'XXXL';
}

export const SIZE_CATEGORIES: SizeCategoryDef[] = [
  {
    id: 'outerwear',
    label: 'Куртки и пальто',
    emoji: '🧥',
    recordLabel: 'Верхняя одежда',
    fields: [{ key: 'chest', label: 'Обхват груди', unit: 'см', placeholder: '100' }],
    compute: (v) => {
      const ru = Math.round(v.chest / 2);
      return [
        { label: 'RU / EU', value: String(ru) },
        { label: 'US', value: String(ru - 10) },
        { label: 'INT', value: outerwearInt(v.chest) },
      ];
    },
  },
  {
    id: 'shirt',
    label: 'Футболки и рубашки',
    emoji: '👕',
    recordLabel: 'Футболка',
    fields: [
      { key: 'chest', label: 'Обхват груди', unit: 'см', placeholder: '100' },
      { key: 'neck', label: 'Обхват шеи (необяз.)', unit: 'см', placeholder: '40' },
    ],
    compute: (v) => {
      const out: SizeResult[] = [
        { label: 'Размер', value: String(Math.round(v.chest / 2)) },
        { label: 'INT', value: shirtInt(v.chest) },
      ];
      if (v.neck) out.push({ label: 'Ворот', value: `${(v.neck + 1.5).toFixed(1)} см` });
      return out;
    },
  },
  {
    id: 'pants',
    label: 'Брюки и джинсы',
    emoji: '👖',
    recordLabel: 'Джинсы',
    fields: [
      { key: 'waist', label: 'Обхват талии', unit: 'см', placeholder: '82' },
      { key: 'inseam', label: 'Длина по внутр. шву (необяз.)', unit: 'см', placeholder: '81' },
    ],
    compute: (v) => {
      const w = Math.round(v.waist / 2.54);
      const out: SizeResult[] = [{ label: 'W (талия)', value: String(w) }];
      if (v.inseam) {
        const l = Math.round(v.inseam / 2.54);
        out.push({ label: 'L (длина)', value: String(l) });
        out.push({ label: 'Размер', value: `W${w}/L${l}` });
      }
      return out;
    },
  },
  {
    id: 'shoes',
    label: 'Обувь',
    emoji: '👟',
    recordLabel: 'Обувь',
    usesGender: true,
    fields: [{ key: 'foot', label: 'Длина стопы', unit: 'см', placeholder: '26' }],
    compute: (v, gender) => {
      const eu = Math.round((v.foot + 1.5) * 1.5);
      const us = gender === 'female' ? eu - 31 : eu - 33;
      return [
        { label: 'RU / EU', value: String(eu) },
        { label: 'US', value: String(us) },
        { label: 'UK', value: String(eu - 34) },
      ];
    },
  },
];

export function getSizeCategory(id: string): SizeCategoryDef | undefined {
  return SIZE_CATEGORIES.find((c) => c.id === id);
}
