import type { ComponentType } from 'react';

/**
 * Sections other agents plug into the settings screen without editing it.
 * Agent S (input): `settingsPanels.controls = BindingsPanel` at module load
 * of its code — the «Controls» tab then renders it instead of the stub.
 */
export const settingsPanels: { controls?: ComponentType } = {};
