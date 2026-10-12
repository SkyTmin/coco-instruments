import type { Catalog } from '../core';
import type { Translation } from '../types';
import { common } from './common';
import { hall } from './hall';
import { mine } from './mine';
import { pets } from './pets';
import { settings } from './settings';
import { skins } from './skins';

const fr: Translation<Catalog> = {
  common,
  hall,
  mine,
  pets,
  settings,
  skins,
};
export default fr;
