// timeline.js : one shot per pet animation. Each shot is exactly one loop (art bible 6), drawn on
// twos, so a contact sheet of a shot shows every drawing of its loop.
(function () {
  'use strict';
  const FILM = window.FILM;
  const ANIMS = [
    ['idle', 24],
    ['walk', 8],
    ['happy', 8],
    ['dig', 8],
    ['attack', 6],
    ['sleep', 24],
  ];
  const PETS = ['mole'];
  const shots = [];
  let t = 0;
  let n = 1;
  for (const pet of PETS) {
    for (const [anim, drawings] of ANIMS) {
      const dur = drawings / 12;
      shots.push({
        id: `${pet}-${anim}`,
        file: `${String(n).padStart(2, '0')}-${pet}-${anim}.js`,
        start: t,
        end: t + dur,
        mode: 'illustrated',
        title: `${pet} ${anim}`,
        post: false,
      });
      t += dur;
      n++;
    }
  }
  FILM.TIMELINE = { title: 'pets', width: 1080, height: 1080, fps: 24, bpm: 120, duration: t, shots, cues: [] };
})();
