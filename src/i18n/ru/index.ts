import { books } from './books';
import { camp } from './camp';
import { campData } from './campData';
import { cash } from './cash';
import { chests } from './chests';
import { common } from './common';
import { critters } from './critters';
import { eggs } from './eggs';
import { field } from './field';
import { finds } from './finds';
import { fishing } from './fishing';
import { fishingData } from './fishingData';
import { forest } from './forest';
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

/**
 * The Russian catalog — source of truth for every language. One file per
 * area; add an area here AND in every `<lang>/index.ts` (tsc enforces it).
 */
export const ru = {
  books,
  camp,
  campData,
  cash,
  chests,
  common,
  critters,
  eggs,
  field,
  finds,
  fishing,
  fishingData,
  forest,
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
} as const;
