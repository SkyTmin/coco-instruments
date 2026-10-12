import type { Catalog } from '../core';
import type { Translation } from '../types';
import { common } from './common';
import { hall } from './hall';
import { pets } from './pets';
import { settings } from './settings';
import { skins } from './skins';

const tr: Translation<Catalog> = {
  common,
  hall,
  pets,
  settings,
  skins,
};
export default tr;
