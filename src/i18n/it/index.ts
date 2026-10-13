import type { Catalog } from '../core';
import type { Translation } from '../types';
import { cash } from './cash';
import { common } from './common';
import { field } from './field';
import { hall } from './hall';
import { mine } from './mine';
import { nursery } from './nursery';
import { pets } from './pets';
import { settings } from './settings';
import { skins } from './skins';
import { slots } from './slots';
import { ui } from './ui';

const it: Translation<Catalog> = {
  cash,
  common,
  field,
  hall,
  mine,
  nursery,
  pets,
  settings,
  skins,
  slots,
  ui,
};
export default it;
