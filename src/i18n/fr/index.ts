import type { Catalog } from '../core';
import type { Translation } from '../types';
import { camp } from './camp';
import { campData } from './campData';
import { cash } from './cash';
import { common } from './common';
import { critters } from './critters';
import { field } from './field';
import { finds } from './finds';
import { forge } from './forge';
import { guide } from './guide';
import { hall } from './hall';
import { hub } from './hub';
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
import { yard } from './yard';
import { yardData } from './yardData';

const fr: Translation<Catalog> = {
  camp,
  campData,
  cash,
  common,
  critters,
  field,
  finds,
  forge,
  guide,
  hall,
  hub,
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
  yard,
  yardData,
};
export default fr;
