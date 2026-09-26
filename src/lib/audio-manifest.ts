// Сгенерировано scripts/audio-build.py — не править руками.
// Число вариантов у каждого звука и длина каждой музыкальной петли.

/** Ревизия набора: входит в адрес файла, чтобы кеш не отдал старый звук. */
export const AUDIO_REV = 'bee67976';

export const SFX_VARIANTS: Record<string, number> = {
  "ui.tap": 3,
  "ui.open": 1,
  "ui.close": 1,
  "ui.tab": 3,
  "ui.buy": 1,
  "ui.error": 1,
  "ui.ok": 1,
  "reel.stop": 5,
  "reel.lever": 2,
  "slot.tension": 1,
  "slot.win.s": 1,
  "slot.win.b": 1,
  "slot.win.m": 1,
  "slot.win.e": 1,
  "slot.win.l": 1,
  "slot.drum.1": 1,
  "slot.drum.2": 1,
  "slot.drum.3": 1,
  "slot.drum.4": 1,
  "slot.drum.5": 1,
  "chip": 4,
  "chip.lay": 3,
  "chips.stack": 3,
  "gem.chime": 2,
  "gem.burst": 5,
  "pluck": 2,
  "bubble": 2,
  "bubble.low": 2,
  "bubble.pop": 2,
  "orb.ring": 1,
  "slam": 3,
  "pick.soil": 5,
  "pick.stone": 5,
  "pick.metal": 5,
  "pick.crystal": 5,
  "pick.star": 3,
  "crit.thud": 3,
  "break.soil": 4,
  "break.stone": 5,
  "break.metal": 4,
  "break.crystal": 4,
  "bag.full": 1,
  "rumble": 1,
  "boom.1": 1,
  "boom.2": 1,
  "boom.3": 1,
  "fuse": 1,
  "tick": 2,
  "case.tick": 3,
  "jingle.found": 1,
  "jingle.up": 1,
  "jingle.go": 1,
  "jingle.down": 1,
  "jingle.nope": 1,
  "jingle.win": 1,
  "jingle.end": 1,
  "jingle.small": 1,
  "axe.chop": 5,
  "saw.bite": 1,
  "log.drop": 5,
  "tree.creak": 2,
  "tree.thud": 3,
  "snow.thud": 3,
  "swing": 5,
  "hit": 8,
  "bite": 3,
  "dash": 1,
  "crate": 2,
  "coins": 2,
  "cloth": 3,
  "gate": 2,
  "clang": 3,
  "latch": 1,
  "winch": 1,
  "roar": 2,
  "card.deal": 4,
  "card.flip": 4,
  "card.shuffle": 1,
  "card.fan": 2,
  "flap": 4,
  "shiny": 4,
  "splash": 3,
  "plop": 2,
  "snap": 2,
  "rat.call": 5,
  "rat.attack": 5,
  "rat.die": 6,
  "bat.squeak": 4,
  "reel.spin": 1,
  "rank.up": 1,
  "soft.up": 1
};

export const MUSIC_TRACKS = {
  "hall": {
    "dur": 59.07694
  },
  "slots": {
    "dur": 103.38463
  },
  "cascade": {
    "dur": 67.76472
  },
  "yard": {
    "dur": 43.8261
  },
  "mine": {
    "dur": 75.0
  },
  "forest": {
    "dur": 78.90413
  },
  "lobby": {
    "dur": 54.31948
  },
  "depths": {
    "dur": 103.66197
  },
  "boss": {
    "dur": 86.4
  },
  "fishing": {
    "dur": 24.51093
  }
} as const;
