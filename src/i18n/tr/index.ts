import type { Catalog } from '../core';
import type { Translation } from '../types';
import { books } from './books';
import { cash } from './cash';
import { chests } from './chests';
import { common } from './common';
import { eggs } from './eggs';
import { field } from './field';
import { finds } from './finds';
import { forge } from './forge';
import { guide } from './guide';
import { hall } from './hall';
import { input } from './input';
import { miles } from './miles';
import { mine } from './mine';
import { mineHud } from './mineHud';
import { nursery } from './nursery';
import { pets } from './pets';
import { settings } from './settings';
import { skins } from './skins';
import { slots } from './slots';
import { ui } from './ui';

const tr: Translation<Catalog> = {
  books,
  cash,
  chests,
  common,
  eggs,
  field,
  finds,
  forge,
  guide,
  hall,
  input,
  miles,
  mine,
  mineHud,
  nursery,
  pets,
  settings,
  skins,
  slots,
  ui,
};
export default tr;
