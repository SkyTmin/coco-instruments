import type { Catalog } from '../core';
import type { Translation } from '../types';
import { common } from './common';
import { settings } from './settings';

const en: Translation<Catalog> = { common, settings };
export default en;
