import { books } from './books';
import { camp } from './camp';
import { campData } from './campData';
import { cash } from './cash';
import { chests } from './chests';
import { common } from './common';
import { creative } from './creative';
import { critters } from './critters';
import { ctabs } from './ctabs';
import { dfloors } from './dfloors';
import { dgear } from './dgear';
import { dlines } from './dlines';
import { dmats } from './dmats';
import { dmobs } from './dmobs';
import { dungeon } from './dungeon';
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
import { inv } from './inv';
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
  creative,
  critters,
  ctabs,
  dfloors,
  dgear,
  dlines,
  dmats,
  dmobs,
  dungeon,
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
  inv,
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
