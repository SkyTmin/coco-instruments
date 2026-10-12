import type { Catalog } from '../core';
import type { Translation } from '../types';
import { common } from './common';
import { settings } from './settings';

const de: Translation<Catalog> = { common, settings };
export default de;
