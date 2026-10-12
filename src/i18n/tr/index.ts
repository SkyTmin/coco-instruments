import type { Catalog } from '../core';
import type { Translation } from '../types';
import { common } from './common';
import { field } from './field';
import { hall } from './hall';
import { mine } from './mine';
import { pets } from './pets';
import { settings } from './settings';
import { skins } from './skins';
import { ui } from './ui';

const tr: Translation<Catalog> = {
  common,
  field,
  hall,
  mine,
  pets,
  settings,
  skins,
  ui,
};
export default tr;
