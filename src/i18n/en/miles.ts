import type { Translation } from '../types';
import type { miles as ru } from '../ru/miles';

export const miles: Translation<typeof ru> = {
  b1k: { title: 'A thousand blocks', text: 'Break them with your own hands' },
  b10k: { title: 'Ten thousand', text: 'Break them with your own hands' },
  b100k: { title: 'A hundred thousand', text: 'Break them with your own hands' },
  b1m: { title: 'A million', text: 'Break them with your own hands' },
  z: { title: 'First Z', text: 'Reach the last rank' },
  p1: { title: 'Prestige 1', text: 'Start your second stretch' },
  p5: { title: 'Prestige 5', text: 'Fifth stretch' },
  p10: { title: 'Prestige 10', text: 'A fourth rune socket' },
  p20: { title: 'Prestige 20', text: 'Twenty stretches' },
  legend: { title: 'Mine Legend', text: 'Push a streak up to “Mine Legend”' },
  pets6: { title: 'Six species', text: 'Hatch six different pets' },
  hatch50: { title: 'Mother Hen', text: 'Hatch fifty eggs' },
  golden: { title: 'Golden pet', text: 'Collect five of the same' },
  zoo: { title: 'The whole zoo', text: 'Collect all 18' },
  cases: { title: 'A hundred chests', text: 'Open them with keys' },
  seid: { title: 'Seid Keeper', text: 'Break ten seid stones' },
  bats: { title: 'Bat Catcher', text: 'Catch thirty bats' },
  parcels: { title: 'A hundred parcels', text: 'Open them' },
};
