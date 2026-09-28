// Звук сверяется с тем, что лежит на диске: каждый звук, который зовёт
// sound.ts, есть в манифесте, у каждой записи манифеста есть файлы, у каждого
// файла — строчка происхождения. Ухом это не проверить, а молчащий звук на
// событии этажа никто не заметит, пока его не ждёт владелец.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { MUSIC_TRACKS, SFX_LOOPS, SFX_VARIANTS } from '@/lib/audio-manifest';
import { FLOOR_SOUNDS, preloadFloorSounds, preloadSounds } from '@/lib/sound';

const ROOT = resolve(__dirname, '..', '..');
const AUDIO = resolve(ROOT, 'public', 'audio');
const SOUND_TS = readFileSync(resolve(__dirname, 'sound.ts'), 'utf8');

describe('звук: манифест и файлы', () => {
  it('каждый звук, который зовёт sound.ts, есть в манифесте', () => {
    const called = new Set<string>();
    for (const m of SOUND_TS.matchAll(/(?:play|jingle|loopSound|load)\(\s*'([a-z0-9.]+)'/g))
      called.add(m[1]);
    // Звуки казино, которые в каторге подменяются пиццикато (CAMP).
    for (const m of SOUND_TS.matchAll(/'(slot\.win\.[a-z])': '(jingle\.[a-z]+)'/g)) {
      called.add(m[1]);
      called.add(m[2]);
    }
    expect(called.size).toBeGreaterThan(80);
    const missing = [...called].filter((n) => !SFX_VARIANTS[n]);
    expect(missing).toEqual([]);
  });

  it('у каждой записи манифеста ровно столько файлов, сколько вариантов', () => {
    const files = new Set(readdirSync(resolve(AUDIO, 'sfx')));
    for (const [name, n] of Object.entries(SFX_VARIANTS)) {
      for (let k = 1; k <= n; k++)
        expect(files.has(`${name}.${k}.mp3`), `${name}.${k}.mp3`).toBe(true);
      expect(files.has(`${name}.${n + 1}.mp3`), `лишний ${name}.${n + 1}.mp3`).toBe(false);
    }
  });

  it('у каждой музыкальной сцены есть трек, у петли-эффекта — длина', () => {
    for (const scene of Object.keys(MUSIC_TRACKS))
      expect(existsSync(resolve(AUDIO, 'music', `${scene}.mp3`)), scene).toBe(true);
    for (const [name, dur] of Object.entries(SFX_LOOPS)) {
      expect(SFX_VARIANTS[name], name).toBeGreaterThan(0);
      expect(dur).toBeGreaterThan(0.5);
    }
  });

  it('у каждого файла есть строчка происхождения в SOURCES.txt', () => {
    const src = new Set(
      readFileSync(resolve(AUDIO, 'SOURCES.txt'), 'utf8')
        .split('\n')
        .map((ln) => ln.split('\t')[0])
        .filter(Boolean),
    );
    const files = [
      ...readdirSync(resolve(AUDIO, 'sfx')).map((f) => `sfx/${f}`),
      ...readdirSync(resolve(AUDIO, 'music')).map((f) => `music/${f}`),
    ];
    expect(files.filter((f) => !src.has(f))).toEqual([]);
  });
});

describe('звук: этажи 6–15 (v2.83)', () => {
  it('набор каждого этажа есть в манифесте', () => {
    for (const [floor, names] of Object.entries(FLOOR_SOUNDS))
      for (const n of names) expect(SFX_VARIANTS[n], `этаж ${floor}: ${n}`).toBeGreaterThan(0);
  });

  it('без аудиоконтекста подгрузка молча ничего не делает', () => {
    // В узле (тест) контекста нет, как в замороженном вебвью Telegram:
    // звук никогда не ломает игру.
    expect(() => preloadSounds('floors')).not.toThrow();
    expect(() => preloadFloorSounds(15)).not.toThrow();
    expect(() => preloadFloorSounds(3)).not.toThrow();
  });

  it('каждая сцена, которую просит этаж, есть среди треков', () => {
    const dir = resolve(__dirname, 'dungeon-floors');
    const scenes = new Set<string>();
    for (const f of readdirSync(dir).filter(
      (x) => /^f\d+(-boss)?\.ts$/.test(x) || x === 'stub.ts',
    )) {
      const txt = readFileSync(resolve(dir, f), 'utf8');
      for (const m of txt.matchAll(/music:\s*\{\s*explore:\s*'([a-z]+)',\s*boss:\s*'([a-z]+)'/g)) {
        scenes.add(m[1]);
        scenes.add(m[2]);
      }
    }
    expect(scenes.size).toBeGreaterThan(0);
    expect([...scenes].filter((s) => !(s in MUSIC_TRACKS))).toEqual([]);
  });
});
