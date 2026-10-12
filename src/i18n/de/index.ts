import type { Catalog } from '../core';
import type { Translation } from '../types';
import { common } from './common';
import { hall } from './hall';
import { nursery } from './nursery';
import { pets } from './pets';
import { settings } from './settings';
import { skins } from './skins';

const de: Translation<Catalog> = {
  common,
  hall,
  nursery,
  pets,
  settings,
  skins,
};
export default de;
