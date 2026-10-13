import type { Catalog } from '../core';
import type { Translation } from '../types';
import { cash } from './cash';
import { common } from './common';
import { creative } from './creative';
import { dfloors } from './dfloors';
import { dgear } from './dgear';
import { dlines } from './dlines';
import { dmats } from './dmats';
import { dmobs } from './dmobs';
import { dungeon } from './dungeon';
import { field } from './field';
import { hall } from './hall';
import { input } from './input';
import { inv } from './inv';
import { mine } from './mine';
import { nursery } from './nursery';
import { pets } from './pets';
import { settings } from './settings';
import { skins } from './skins';
import { slots } from './slots';
import { ui } from './ui';

const es: Translation<Catalog> = {
  cash,
  common,
  creative,
  dfloors,
  dgear,
  dlines,
  dmats,
  dmobs,
  dungeon,
  field,
  hall,
  input,
  inv,
  mine,
  nursery,
  pets,
  settings,
  skins,
  slots,
  ui,
};
export default es;
