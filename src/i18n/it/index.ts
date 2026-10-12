import type { Catalog } from '../core';
import type { Translation } from '../types';
import { common } from './common';
import { hall } from './hall';
import { input } from './input';
import { pets } from './pets';
import { settings } from './settings';
import { skins } from './skins';

const it: Translation<Catalog> = {
  common,
  hall,
  input,
  pets,
  settings,
  skins,
};
export default it;
