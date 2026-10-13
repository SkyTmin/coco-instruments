import type { Catalog } from '../core';
import type { Translation } from '../types';
import { cash } from './cash';
import { common } from './common';
import { field } from './field';
import { hall } from './hall';
import { input } from './input';
import { nursery } from './nursery';
import { mine } from './mine';
import { pets } from './pets';
import { settings } from './settings';
import { skins } from './skins';
import { slots } from './slots';
import { ui } from './ui';

const de: Translation<Catalog> = {
  cash,
  common,
  field,
  hall,
  input,
  nursery,
  mine,
  pets,
  settings,
  skins,
  slots,
  ui,
};
export default de;
