import type { Catalog } from '../core';
import type { Translation } from '../types';
import { cash } from './cash';
import { common } from './common';
import { field } from './field';
import { hall } from './hall';
import { input } from './input';
import { mine } from './mine';
import { nursery } from './nursery';
import { pets } from './pets';
import { settings } from './settings';
import { skins } from './skins';
import { slots } from './slots';
import { ui } from './ui';

const fr: Translation<Catalog> = {
  cash,
  common,
  field,
  hall,
  input,
  mine,
  nursery,
  pets,
  settings,
  skins,
  slots,
  ui,
};
export default fr;
