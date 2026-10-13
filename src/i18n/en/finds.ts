import type { Translation } from '../types';
import type { finds as ru } from '../ru/finds';

export const finds: Translation<typeof ru> = {
  coin: { name: 'Old coin', text: 'A kopeck from 1799' },
  key: { name: 'Cell key', text: 'Rusty, but it still turns' },
  fern: { name: 'Fern fossil', text: 'Carboniferous period' },
  ammonite: { name: 'Ammonite', text: 'A shell coiled into a spiral' },
  trilobite: { name: 'Trilobite', text: 'Half a billion years old' },
  nugget: { name: 'Gold nugget', text: 'Pure gold, nothing mixed in' },
  tooth: { name: 'Mammoth tooth', text: 'Kept by the permafrost' },
  geode: { name: 'Geode', text: 'Stone outside, amethyst inside' },
  amber: { name: 'Amber with a fly', text: 'A fly frozen forty million years ago' },
  medal: { name: "Tsar's medal", text: '“For Diligence”' },
  core: { name: 'Kola Superdeep core', text: 'From twelve kilometers down' },
  lamp: { name: "First miner's lamp", text: 'Still burning' },
};
