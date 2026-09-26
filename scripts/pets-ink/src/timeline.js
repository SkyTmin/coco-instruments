// timeline.js : one shot per pet animation. Each shot is exactly one loop (art bible 6), so a
// contact sheet of a shot shows every drawing of its loop. Mirrors FILM.pets.ANIMS in cast.js
// (the timeline is evaluated by the tools without the page, so it keeps its own copy).
(function () {
  'use strict';
  const FILM = window.FILM;
  const ANIMS = [
    ['idle', 12, 6],
    ['walk', 8, 12],
    ['happy', 8, 12],
    ['work', 8, 12],
    ['attack', 6, 12],
    ['sleep', 12, 6],
  ];
  const PETS = ['mole', 'mouse', 'badger', 'raccoon', 'cat', 'bulldog', 'ferret', 'shepherd', 'fox', 'wolf', 'dragon', 'pigeon', 'crow', 'owl', 'raven', 'phoenix'];
  const shots = [];
  let t = 0;
  let n = 1;
  for (const pet of PETS) {
    for (const [anim, drawings, fps] of ANIMS) {
      const dur = drawings / fps;
      shots.push({
        id: `${pet}-${anim}`,
        file: `${String(n).padStart(3, '0')}-${pet}-${anim}.js`,
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
