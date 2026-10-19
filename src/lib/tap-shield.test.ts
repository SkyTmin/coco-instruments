import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLOSE_GUARD_MS,
  OPEN_GUARD_MS,
  raiseTapShield,
  resetTapShield,
  shieldDecides,
  shieldOnClose,
  shieldOnOpen,
} from './tap-shield';

let clock = 0;
beforeEach(() => {
  resetTapShield();
  clock = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
});
afterEach(() => vi.restoreAllMocks());

/** One tap: down at `t`, up + click `hold` ms later; returns what the page would see. */
function tap(t: number, hold = 40): string[] {
  return [
    shieldDecides('pointerdown', 0, t),
    shieldDecides('pointerup', 0, t + hold),
    shieldDecides('click', 1, t + hold),
  ];
}

describe('tap shield (R44 / R72)', () => {
  it('passes everything with no shield', () => {
    expect(tap(1000)).toEqual(['pass', 'pass', 'pass']);
  });

  it('swallows a whole gesture that starts inside the shield, even if it ends after it', () => {
    raiseTapShield(CLOSE_GUARD_MS, 1000);
    expect(tap(1090)).toEqual(['block', 'block', 'block']);
    // Starts 10 ms before the end, its click lands after the end: still one swallowed gesture.
    expect(tap(1340, 60)).toEqual(['block', 'block', 'block']);
    expect(tap(1400)).toEqual(['pass', 'pass', 'pass']);
  });

  it('lets keyboard / pad activations through', () => {
    raiseTapShield(CLOSE_GUARD_MS, 1000);
    shieldDecides('pointerdown', 0, 1050);
    expect(shieldDecides('click', 0, 1100)).toBe('pass');
  });

  it('times the open guard from the opening tap, not from a slow mount', () => {
    tap(1000); // the opener: up at 1040
    clock = 1220; // the window mounts 180 ms later
    shieldOnOpen();
    expect(tap(1300)[0]).toBe('block'); // 260 ms after the opener's up
    expect(tap(1345)[0]).toBe('pass'); // 305 ms after it
  });

  it('guards a window that opened by itself from its mount', () => {
    clock = 5000;
    shieldOnOpen();
    expect(tap(5000 + OPEN_GUARD_MS - 10)[0]).toBe('block');
    expect(tap(5000 + OPEN_GUARD_MS + 10)[0]).toBe('pass');
  });

  it('closes with a page guard; a same-tick re-mount (StrictMode) keeps only the open guard', () => {
    clock = 2000;
    shieldOnClose();
    expect(tap(2000 + CLOSE_GUARD_MS - 10)[0]).toBe('block');
    resetTapShield();
    clock = 3000;
    shieldOnOpen();
    shieldOnClose();
    shieldOnOpen();
    expect(tap(3000 + OPEN_GUARD_MS + 10)[0]).toBe('pass');
  });
});
