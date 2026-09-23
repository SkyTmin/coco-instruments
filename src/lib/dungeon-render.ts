// Рисовальщик подземелья. Мир меряется «игровыми пикселями» (клетка — 16), а
// рисуется СРАЗУ на экран с целым множителем: пиксель спрайта — ровный
// квадрат из нескольких точек экрана, но сдвигаться он может на одну точку.
// Первая сборка рисовала в маленький буфер и растягивала его: камера и
// спрайты прыгали целыми игровыми пикселями (7 точек на телефоне), и при
// ходьбе всё тряслось — владелец: «очень быстро, очень сильно трясёт».
//
// Порядок кадра: куски карты из кеша → метки угроз на полу → предметы, мобы
// и герой по глубине → частицы и следы ударов → свет → растяжка → цифры.
// Анимируем только то, что в канве: DOM страницы этот цикл не трогает.

import { areaOf, MOBS } from './dungeon';
import type { AreaId, Gear, MobId } from './dungeon';
import {
  boardTile,
  burrowFront,
  burrowSide,
  crackWallTile,
  floorTile,
  glowBlob,
  grateTile,
  heroFlash,
  heroFrame,
  heroFrames,
  itemArt,
  liftFloorTile,
  lightBlob,
  minePortal,
  mobArt,
  propArt,
  puddleTile,
  railTile,
  rubbleTile,
  TS,
  wallLamp,
  wallTile,
  weaponArt,
} from './dungeon-art';
import type { Dir, HeroAnim, MobAnim, PropArt } from './dungeon-art';
import { SKILL, SWORD } from './dungeon-sim';
import type { Mob, Sim, SimEvent } from './dungeon-sim';
import { bandAt, fogGet, Tile, walkableTile } from './dungeon-world';
import type { World } from './dungeon-world';
import { bladeSprite, fxCount, fxFrame, heroSprite, ROW, spritesReady } from './dungeon-sprites';
import type { Dir4, FxId } from './dungeon-sprites';

const CHUNK = 16;

/**
 * Насколько снимается темнота с разведанного. Владелец: «прошёлся один раз —
 * туман исчезает и там больше не появляется». Не 1: чуть сумрака оставляет
 * лампам и фонарю героя работу — светлое пятно вокруг всё ещё видно.
 */
const EXPLORED_LIT = 0.82;

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  color: string;
  /** Пыль и дым не прыгают — расплываются. */
  soft: boolean;
  glow: boolean;
}

interface Float {
  x: number;
  y: number;
  text: string;
  color: string;
  size: number;
  life: number;
  max: number;
  vx: number;
}

interface Slash {
  x: number;
  y: number;
  ang: number;
  arc: number;
  reach: number;
  life: number;
  max: number;
  heavy: boolean;
  flip: boolean;
  step: number;
}

/** Рисованный эффект из набора: кадры листа по времени жизни. */
interface Fx {
  id: FxId;
  x: number;
  y: number;
  life: number;
  max: number;
  ang: number;
  scale: number;
  /** Отражение по вертикали — серп, идущий сверху вниз. */
  flip: boolean;
  /** Идёт за героем: след клинка и кольцо уровня не висят в воздухе. */
  follow: boolean;
  /** Смещение от героя в мировых пикселях — для тех, что идут за ним. */
  dx: number;
  dy: number;
  alpha: number;
}

interface Ring {
  x: number;
  y: number;
  r: number;
  life: number;
  max: number;
  color: string;
}

const reduce = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** Гладкий шум для тряски (как в `juice.ts`): случайное число на кадр — это брак. */
function noise(t: number, seed: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const h = (n: number) => {
    const s = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
    return (s - Math.floor(s)) * 2 - 1;
  };
  const u = f * f * (3 - 2 * f);
  return h(i) * (1 - u) + h(i + 1) * u;
}

interface Ghost {
  x: number;
  y: number;
  img: HTMLCanvasElement;
  life: number;
  /** Где верх картинки относительно ног: у старого героя и у спрайта разный. */
  top: number;
}

export class DungeonRenderer {
  readonly view: HTMLCanvasElement;
  private vctx: CanvasRenderingContext2D;
  /** Контекст рисования мира — экранная канва с масштабом. */
  private bctx: CanvasRenderingContext2D;
  private light: HTMLCanvasElement;
  private lctx: CanvasRenderingContext2D;
  /** Масштаб: игровой пиксель = столько экранных. */
  scale = 4;
  gw = 160;
  gh = 300;
  private ox = 0;
  private oy = 0;
  private dpr = 1;
  /** Камера — мировые пиксели центра кадра. */
  camX = 0;
  camY = 0;
  private camReady = false;
  private chunks = new Map<number, { c: HTMLCanvasElement; snap: Uint8Array; sig: string }>();
  /** Трещины по куску карты — их стадия меняет картинку стены. */
  private crackObjs = new Map<number, { id: string; x: number; y: number }[]>();
  private crackWorld: World | null = null;
  private parts: Particle[] = [];
  private floats: Float[] = [];
  private slashes: Slash[] = [];
  private rings: Ring[] = [];
  private fx: Fx[] = [];
  private trauma = 0;
  private shakeT = 0;
  private flash = 0;
  private time = 0;
  /** Взрыв светит пару кадров. */
  private blasts: { x: number; y: number; r: number; life: number }[] = [];
  /** Глаза крыс светятся поверх темноты — видно, откуда лезут. */
  private eyes: { x: number; y: number; c: string }[] = [];
  /** Шлейф рывка: силуэты героя, тающие за ним. */
  private ghosts: Ghost[] = [];
  private ghostT = 0;
  private dt = 0;
  /** Маска разведанного: точка на клетку, на свет ложится со сглаживанием. */
  private fogCv: HTMLCanvasElement | null = null;
  /** Упреждение камеры по ходу — сглажено отдельно от самой камеры. */
  private leadX = 0;
  private leadY = 0;

  constructor(view: HTMLCanvasElement) {
    this.view = view;
    this.vctx = view.getContext('2d')!;
    this.bctx = this.vctx;
    this.light = document.createElement('canvas');
    this.lctx = this.light.getContext('2d')!;
  }

  /** Подогнать под размер экрана: множитель целый, игровой кадр ~160 пикселей в ширину. */
  resize(cssW: number, cssH: number, dpr: number): void {
    this.dpr = Math.min(3, Math.max(1, dpr));
    const w = Math.max(1, Math.round(cssW * this.dpr));
    const h = Math.max(1, Math.round(cssH * this.dpr));
    this.view.width = w;
    this.view.height = h;
    this.scale = Math.max(1, Math.floor(w / 150));
    this.gw = w / this.scale;
    this.gh = h / this.scale;
    this.light.width = Math.ceil(this.gw) + 2;
    this.light.height = Math.ceil(this.gh) + 2;
    this.ox = 0;
    this.oy = 0;
    this.vctx.imageSmoothingEnabled = false;
  }

  /** Координата в игровых пикселях, прижатая к точке экрана. */
  private q = (v: number) => Math.round(v * this.scale) / this.scale;

  /** Экранные CSS-координаты точки мира — для тапа по мобу. */
  toScreen(x: number, y: number): { x: number; y: number } {
    const gx = x * TS - this.camX + this.gw / 2;
    const gy = y * TS - this.camY + this.gh / 2;
    return {
      x: (this.ox + gx * this.scale) / this.dpr,
      y: (this.oy + gy * this.scale) / this.dpr,
    };
  }

  toWorld(cssX: number, cssY: number): { x: number; y: number } {
    const gx = (cssX * this.dpr - this.ox) / this.scale;
    const gy = (cssY * this.dpr - this.oy) / this.scale;
    return { x: (gx + this.camX - this.gw / 2) / TS, y: (gy + this.camY - this.gh / 2) / TS };
  }

  addTrauma(t: number): void {
    this.trauma = Math.min(1, this.trauma + t);
  }

  // ---- События симуляции → эффекты -------------------------------------

  onEvents(sim: Sim, events: SimEvent[]): void {
    for (const e of events) {
      switch (e.t) {
        case 'swing':
          this.slashes.push({
            x: e.x,
            y: e.y,
            ang: e.ang,
            arc: e.arc,
            reach: e.reach,
            life: 0,
            max: e.heavy ? 0.24 : 0.16,
            heavy: e.heavy,
            flip: e.step % 2 === 1,
            step: e.step,
          });
          break;
        case 'hit': {
          const big = e.crit || e.kill;
          this.burst(
            e.x,
            e.y,
            e.boss ? ['#8a7a68', '#c8b8a0', '#ffffff'] : ['#6b6158', '#978b80', '#3d3630'],
            big ? 10 : 5,
            big ? 1.6 : 1,
          );
          if (e.dmg > 0)
            this.floats.push({
              x: e.x + (Math.random() - 0.5) * 0.4,
              y: e.y - 0.6,
              text: e.crit ? `${e.dmg}!` : `${e.dmg}`,
              color: e.crit ? '#ffd24a' : e.kill ? '#ffffff' : '#f0e6d8',
              size: e.crit ? 1.5 : 1,
              life: 0,
              max: e.crit ? 0.9 : 0.7,
              vx: (Math.random() - 0.5) * 0.8,
            });
          // Искра попадания — звезда набора; крит — крест, его видно издалека.
          this.addFx(
            e.crit ? 7 : 5,
            e.x + (Math.random() - 0.5) * 0.3,
            e.y - 0.35,
            e.crit ? 0.26 : 0.18,
            {
              scale: e.crit ? 0.85 : 0.55,
              ang: e.crit ? 0 : (Math.random() - 0.5) * 0.6,
            },
          );
          if (e.crit) this.addTrauma(0.18);
          if (e.boss) this.addTrauma(0.08);
          break;
        }
        case 'kill': {
          const colors =
            e.mob === 'goldrat'
              ? ['#d8a83a', '#fff0a8', '#8a6418']
              : e.albino
                ? ['#ebe4de', '#ffffff', '#b3a79f']
                : ['#6b6158', '#978b80', '#3d3630', '#c68d84'];
          const big = e.mob === 'king' || e.mob === 'kinglet';
          this.burst(e.x, e.y, colors, big ? 40 : 14, 1.8);
          // Клуб дыма набора на месте крысы: тело не «исчезает», а лопается.
          // Небольшой и полупрозрачный: четыре крысы одним ударом — это четыре
          // клуба, и крупные сливались в белую кляксу поверх выпавшего мяса.
          if (
            !this.addFx(18, e.x, e.y - 0.25, big ? 0.6 : 0.36, {
              scale: big ? 1.5 : 0.6,
              alpha: big ? 0.9 : 0.7,
            })
          )
            this.puff(e.x, e.y, 'rgba(160,140,120,0.8)', 5);
          if (e.elite || e.albino) {
            this.rings.push({ x: e.x, y: e.y, r: 2.2, life: 0, max: 0.4, color: '#ffd24a' });
            this.addTrauma(0.25);
          }
          break;
        }
        case 'hurt':
          this.addTrauma(0.3);
          this.flash = Math.max(this.flash, 0.12);
          this.floats.push({
            x: e.x,
            y: e.y - 1.2,
            text: `−${e.dmg}`,
            color: '#ff5a4a',
            size: 1.2,
            life: 0,
            max: 0.8,
            vx: 0,
          });
          break;
        case 'boom':
          if (e.r > 0) {
            this.addTrauma(0.55);
            this.flash = Math.max(this.flash, 0.1);
            this.blasts.push({ x: e.x, y: e.y, r: e.r * 2.2, life: 0.35 });
            if (!this.addFx(12, e.x, e.y - 0.3, 0.4, { scale: (e.r * TS) / 14 }))
              this.rings.push({ x: e.x, y: e.y, r: e.r, life: 0, max: 0.35, color: '#ffb040' });
            this.burst(e.x, e.y, ['#ffd24a', '#ff7a2a', '#fff3b0', '#5a4a3e'], 30, 2.4, true);
            this.puff(e.x, e.y, 'rgba(70,60,52,0.9)', 12);
          } else {
            this.addTrauma(0.2);
            this.puff(e.x, e.y, 'rgba(150,130,110,0.8)', 6);
          }
          break;
        case 'break':
          this.burst(
            e.x,
            e.y,
            e.kind === 'crack'
              ? ['#65554a', '#463a31', '#7d6b5c']
              : ['#8a6038', '#b0804e', '#5a3a1e'],
            16,
            1.6,
          );
          this.puff(e.x, e.y, 'rgba(160,140,120,0.8)', 6);
          this.addTrauma(0.12);
          break;
        case 'emerge':
          this.puff(e.x, e.y, 'rgba(120,96,70,0.8)', 4);
          break;
        case 'dash':
          this.puff(e.x, e.y + 0.3, 'rgba(160,140,120,0.7)', 5);
          break;
        case 'dodge':
          if (!this.addFx(1, e.x, e.y - 0.3, 0.3, { scale: 1.2 }))
            this.rings.push({ x: e.x, y: e.y, r: 1.6, life: 0, max: 0.45, color: '#8fd6ff' });
          break;
        case 'pick':
          this.floatPick(e.x, e.y, e.what, e.n);
          break;
        case 'eat':
          this.floats.push({
            x: sim.hero.x,
            y: sim.hero.y - 1.3,
            text: `+${e.heal}`,
            color: '#7ae07a',
            size: 1.1,
            life: 0,
            max: 0.9,
            vx: 0,
          });
          break;
        case 'level':
          if (!this.addFx(4, 0, 0, 0.6, { scale: 1.4, follow: true, dy: -5 }))
            this.rings.push({
              x: sim.hero.x,
              y: sim.hero.y,
              r: 2.6,
              life: 0,
              max: 0.7,
              color: '#ffe08a',
            });
          this.burst(sim.hero.x, sim.hero.y, ['#ffe08a', '#fff6c8', '#ffb040'], 24, 1.8, true);
          break;
        case 'skill':
          if (
            !this.addFx(9, 0, 0, SKILL.dur * 0.8, {
              scale: (SKILL.reach * TS) / 14,
              follow: true,
              dy: -5,
            })
          )
            this.rings.push({
              x: e.x,
              y: e.y,
              r: SKILL.reach,
              life: 0,
              max: 0.5,
              color: '#ffffff',
            });
          break;
        case 'boss':
          if (e.what === 'wake' || e.what === 'split') this.addTrauma(0.6);
          if (e.what === 'dead') {
            this.addTrauma(0.9);
            this.flash = 0.2;
          }
          break;
        case 'clank':
          this.burst(e.x, e.y, ['#ffd24a', '#ffffff'], 6, 1.2, true);
          this.addFx(5, e.x, e.y - 0.35, 0.16, { scale: 0.45 });
          break;
      }
    }
  }

  /** Эффект из набора. false — картинки ещё не пришли, пусть рисуется прежний. */
  private addFx(id: FxId, x: number, y: number, max: number, o: Partial<Fx> = {}): boolean {
    if (!fxCount(id)) return false;
    this.fx.push({
      id,
      x,
      y,
      life: 0,
      max,
      ang: 0,
      scale: 1,
      flip: false,
      follow: false,
      dx: 0,
      dy: 0,
      alpha: 1,
      ...o,
    });
    return true;
  }

  private burst(
    x: number,
    y: number,
    colors: string[],
    n: number,
    power: number,
    glow = false,
  ): void {
    if (reduce()) n = Math.min(n, 4);
    for (let i = 0; i < n && this.parts.length < 500; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (1.5 + Math.random() * 3) * power;
      this.parts.push({
        x,
        y,
        z: 0.3,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s * 0.7,
        vz: 2 + Math.random() * 4 * power,
        life: 0,
        max: 0.5 + Math.random() * 0.5,
        size: Math.random() < 0.3 ? 2 : 1,
        color: colors[Math.floor(Math.random() * colors.length)],
        soft: false,
        glow,
      });
    }
  }

  private puff(x: number, y: number, color: string, n: number): void {
    for (let i = 0; i < n && this.parts.length < 500; i++) {
      const a = Math.random() * Math.PI * 2;
      this.parts.push({
        x: x + Math.cos(a) * 0.2,
        y: y + Math.sin(a) * 0.2,
        z: 0.2,
        vx: Math.cos(a) * 0.8,
        vy: Math.sin(a) * 0.5 - 0.3,
        vz: 0,
        life: 0,
        max: 0.5 + Math.random() * 0.3,
        size: 3 + Math.random() * 2,
        color,
        soft: true,
        glow: false,
      });
    }
  }

  private floatPick(x: number, y: number, what: string, n: number): void {
    const names: Record<string, [string, string]> = {
      coin: [`+${n}`, '#ffd24a'],
      token: [`+${n}✦`, '#7fe6d0'],
      key: ['+ключ', '#9fe6f0'],
      crown: ['КОРОНА', '#ffd24a'],
    };
    const t = names[what];
    if (!t) return;
    this.floats.push({ x, y: y - 0.6, text: t[0], color: t[1], size: 1, life: 0, max: 0.8, vx: 0 });
  }

  // ---- Кадр -------------------------------------------------------------

  frame(sim: Sim, gear: Gear, dt: number): void {
    this.time += dt;
    this.dt = dt;
    const w = sim.world;
    const h = sim.hero;
    const g = this.bctx;
    // Камера: впереди по ходу, герой чуть ниже середины — вглубь смотрим вверх.
    // Упреждение сглажено само по себе и не берёт скорость рывка: иначе каждый
    // рывок и каждое скольжение вдоль стены дёргали бы весь кадр.
    if (h.mode !== 'dash') {
      const kl = 1 - Math.exp(-2.5 * dt);
      this.leadX += (h.vx * 0.3 * TS - this.leadX) * kl;
      this.leadY += (h.vy * 0.3 * TS - this.leadY) * kl;
    }
    const tx = h.x * TS + this.leadX;
    const ty = h.y * TS + this.leadY - this.gh * 0.1;
    if (!this.camReady) {
      this.camX = tx;
      this.camY = ty;
      this.camReady = true;
    }
    const k = 1 - Math.exp(-6 * dt);
    this.camX += (tx - this.camX) * k;
    this.camY += (ty - this.camY) * k;
    const maxX = w.w * TS - this.gw / 2;
    this.camX = Math.max(this.gw / 2, Math.min(maxX, this.camX));
    this.camY = Math.max(
      this.gh / 2 - TS * 2,
      Math.min(w.h * TS - this.gh / 2 + TS * 2, this.camY),
    );

    // Тряска по Айзерло: смещение ∝ квадрату травмы, гладкий шум.
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    this.shakeT += dt * 30;
    const sh = reduce() ? 0 : this.trauma * this.trauma;
    const sx = noise(this.shakeT, 1) * 4 * sh;
    const sy = noise(this.shakeT, 2) * 4 * sh;
    const left = this.q(this.camX - this.gw / 2 + sx);
    const top = this.q(this.camY - this.gh / 2 + sy);

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#07060a';
    g.fillRect(0, 0, this.view.width, this.view.height);
    g.setTransform(this.scale, 0, 0, this.scale, 0, 0);

    // Куски карты.
    const c0 = Math.floor(left / (CHUNK * TS));
    const c1 = Math.floor((left + this.gw) / (CHUNK * TS));
    const r0 = Math.floor(top / (CHUNK * TS));
    const r1 = Math.floor((top + this.gh) / (CHUNK * TS));
    for (let cy = r0; cy <= r1; cy++)
      for (let cx = c0; cx <= c1; cx++) {
        if (cx < 0 || cy < 0 || cx * CHUNK >= w.w || cy * CHUNK >= w.h) continue;
        const c = this.chunk(sim, cx, cy);
        g.drawImage(c, cx * CHUNK * TS - left, cy * CHUNK * TS - top);
      }

    // Метки угроз на полу.
    this.drawTelegraphs(sim, left, top);

    // Предметы, мобы, герой, добыча — по глубине.
    type D = { y: number; draw: () => void };
    const list: D[] = [];
    const inView = (x: number, y: number, m = 3) =>
      x * TS > left - m * TS &&
      x * TS < left + this.gw + m * TS &&
      y * TS > top - m * TS &&
      y * TS < top + this.gh + m * 4 * TS;

    for (const p of sim.props) {
      if (!p.alive || !inView(p.x, p.y)) continue;
      const art: PropArt =
        p.kind === 'secret'
          ? p.on
            ? 'chestOpen'
            : 'chest'
          : p.kind === 'unlit' && p.on
            ? 'lantern'
            : (p.kind as PropArt);
      const img = propArt(art, p.flash > 0);
      const bottom = p.kind === 'cart' ? p.y + 0.45 : Math.floor(p.y) + 1;
      list.push({
        y: bottom - (p.kind === 'pillar' ? 0.05 : 0),
        draw: () => {
          g.fillStyle = 'rgba(0,0,0,0.28)';
          g.beginPath();
          g.ellipse(
            p.x * TS - left,
            bottom * TS - top - 2,
            img.width * 0.45,
            2.5,
            0,
            0,
            Math.PI * 2,
          );
          g.fill();
          g.drawImage(
            img,
            this.q(p.x * TS - left - img.width / 2),
            this.q(bottom * TS - top - img.height),
          );
        },
      });
    }
    // Клеть и ворота арены.
    for (const o of w.objs) {
      if (o.kind === 'lift' && inView(o.x, o.y, 4)) {
        const img = propArt('liftFrame');
        list.push({
          y: o.y - 1.3,
          draw: () =>
            g.drawImage(
              img,
              this.q((o.x + 0.5) * TS - left - img.width / 2),
              this.q((o.y + 2) * TS - top - img.height),
            ),
        });
      }
      if (o.kind === 'gate' && inView(o.x, o.y) && sim.tiles[o.y * w.w + o.x] === Tile.Gate) {
        const img = propArt('gate');
        list.push({
          y: o.y + 1,
          draw: () =>
            g.drawImage(img, this.q(o.x * TS - left), this.q((o.y + 1) * TS - top - img.height)),
        });
      }
    }
    for (const m of sim.mobs) {
      if (!inView(m.x, m.y)) continue;
      list.push({ y: m.y + 0.01, draw: () => this.drawMob(sim, m, left, top) });
    }
    for (const b of sim.bombs) {
      if (!inView(b.x, b.y)) continue;
      list.push({
        y: b.y,
        draw: () => {
          const img = propArt('bomb');
          g.drawImage(img, this.q(b.x * TS - left - 4), this.q(b.y * TS - top - 5));
          // Фитиль искрит, тем чаще, чем меньше осталось.
          if (Math.sin(this.time * (8 + (1.6 - b.fuse) * 20)) > 0) {
            g.fillStyle = '#fff3b0';
            g.fillRect(this.q(b.x * TS - left + 3), this.q(b.y * TS - top - 6), 1, 1);
          }
        },
      });
    }
    for (const d of sim.drops) {
      if (!inView(d.x, d.y)) continue;
      list.push({
        y: d.y,
        draw: () => {
          const img = itemArt(d.kind);
          const bob = d.z <= 0 ? Math.sin(this.time * 4 + d.id) * 0.8 : 0;
          g.fillStyle = 'rgba(0,0,0,0.3)';
          g.fillRect(this.q(d.x * TS - left - 3), this.q(d.y * TS - top + 2), 6, 1);
          g.drawImage(img, this.q(d.x * TS - left - 5), this.q((d.y - d.z) * TS - top - 8 + bob));
        },
      });
    }
    list.push({ y: h.y + 0.02, draw: () => this.drawHero(sim, gear, left, top) });
    list.sort((a, b) => a.y - b.y);
    for (const d of list) d.draw();

    // Частицы.
    this.drawParticles(dt, left, top);
    this.drawSlashes(sim, dt, left, top);
    this.drawRings(dt, left, top);
    this.drawFx(sim, dt, left, top);

    // Свет.
    this.drawLight(sim, left, top, dt);
    for (const e of this.eyes) {
      g.fillStyle = e.c;
      g.globalAlpha = 0.9;
      g.fillRect(e.x, e.y, 1, 1);
    }
    g.globalAlpha = 1;
    this.eyes.length = 0;

    // Вспышка удара и замедление — поверх мира.
    if (this.flash > 0) {
      g.fillStyle = `rgba(255,240,230,${Math.min(0.35, this.flash * 2)})`;
      g.fillRect(0, 0, this.gw, this.gh);
      this.flash = Math.max(0, this.flash - dt);
    }
    if (sim.slowmo > 0) {
      g.fillStyle = `rgba(80,150,255,${Math.min(0.14, sim.slowmo * 0.3)})`;
      g.fillRect(0, 0, this.gw, this.gh);
    }

    // Цифры — уже в точках экрана.
    g.setTransform(1, 0, 0, 1, 0, 0);
    this.drawFloats(dt, left, top);
  }

  // ---- Куски карты -------------------------------------------------------

  private chunk(sim: Sim, cx: number, cy: number): HTMLCanvasElement {
    const w = sim.world;
    const key = cy * 1000 + cx;
    const x0 = cx * CHUNK;
    const y0 = cy * CHUNK;
    // Кусок устарел, если в нём сменилась клетка (решётка, осыпавшаяся
    // трещина, ворота арены) или трещина получила удар.
    if (this.crackWorld !== w) {
      this.crackWorld = w;
      this.crackObjs.clear();
      for (const o of w.objs) {
        if (o.kind !== 'crack') continue;
        const k = Math.floor(o.y / CHUNK) * 1000 + Math.floor(o.x / CHUNK);
        const list = this.crackObjs.get(k) ?? [];
        list.push({ id: o.id, x: o.x, y: o.y });
        this.crackObjs.set(k, list);
      }
    }
    const cracks = this.crackObjs.get(key) ?? [];
    const sig = cracks.map((c) => sim.cracks.get(c.id) ?? 0).join(',');
    let hit = this.chunks.get(key);
    let stale = !hit || hit.sig !== sig;
    if (hit && !stale) {
      for (let y = 0; y < CHUNK && !stale; y++)
        for (let x = 0; x < CHUNK; x++) {
          const tx = x0 + x;
          const ty = y0 + y;
          if (tx >= w.w || ty >= w.h) continue;
          if (hit.snap[y * CHUNK + x] !== sim.tiles[ty * w.w + tx]) {
            stale = true;
            break;
          }
        }
    }
    if (!stale && hit) return hit.c;
    const c = hit?.c ?? document.createElement('canvas');
    c.width = CHUNK * TS;
    c.height = CHUNK * TS;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, c.width, c.height);
    const snap = new Uint8Array(CHUNK * CHUNK);
    const t = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= w.w || y >= w.h) return Tile.Wall;
      return sim.tiles[y * w.w + x];
    };
    const open = (v: number) => walkableTile(v) || v === Tile.Gate || v === Tile.Grate;
    for (let y = 0; y < CHUNK; y++)
      for (let x = 0; x < CHUNK; x++) {
        const tx = x0 + x;
        const ty = y0 + y;
        if (tx >= w.w || ty >= w.h) continue;
        const v = t(tx, ty);
        snap[y * CHUNK + x] = v;
        const area: AreaId = bandAt(w, ty).def.id;
        const deco = w.deco[ty * w.w + tx];
        const px = x * TS;
        const py = y * TS;
        if (open(v) || v === Tile.Lift) {
          g.drawImage(v === Tile.Lift ? liftFloorTile() : floorTile(area, deco), px, py);
          if (v === Tile.RailV) g.drawImage(railTile(area, 'v'), px, py);
          if (v === Tile.RailH) g.drawImage(railTile(area, 'h'), px, py);
          if (v === Tile.Puddle) g.drawImage(puddleTile(deco), px, py);
          if (v === Tile.Grate) g.drawImage(grateTile(false), px, py);
          // Тень от стен у подножия: сверху — полоса, сбоку — кромка.
          if (!open(t(tx, ty - 1)) && t(tx, ty - 1) !== Tile.Lift) {
            g.fillStyle = 'rgba(0,0,0,0.38)';
            g.fillRect(px, py, TS, 2);
            g.fillStyle = 'rgba(0,0,0,0.18)';
            g.fillRect(px, py + 2, TS, 2);
          }
          if (!open(t(tx - 1, ty))) {
            g.fillStyle = 'rgba(0,0,0,0.25)';
            g.fillRect(px, py, 2, TS);
          }
          if (!open(t(tx + 1, ty))) {
            g.fillStyle = 'rgba(0,0,0,0.25)';
            g.fillRect(px + TS - 2, py, 2, TS);
          }
        } else {
          const front = open(t(tx, ty + 1)) || t(tx, ty + 1) === Tile.Lift;
          if (v === Tile.Crack) {
            const c = cracks.find((o) => o.x === tx && o.y === ty);
            g.drawImage(crackWallTile(area, c ? (sim.cracks.get(c.id) ?? 0) : 0), px, py);
          } else if (v === Tile.Rubble) {
            g.drawImage(floorTile(area, deco), px, py);
            g.drawImage(rubbleTile(area, deco), px, py);
          } else
            g.drawImage(
              wallTile(area, deco, front, open(t(tx - 1, ty)), open(t(tx + 1, ty))),
              px,
              py,
            );
        }
      }
    // Настенное: норы, лампы, шахты, доска; открытая решётка.
    for (const o of w.objs) {
      if (o.x < x0 || o.x >= x0 + CHUNK || o.y < y0 || o.y >= y0 + CHUNK) continue;
      const px = (o.x - x0) * TS;
      const py = (o.y - y0) * TS;
      if (o.kind === 'burrow' && o.out) {
        if (o.face === 'front') g.drawImage(burrowFront(), px, py);
        else {
          const right = o.out[0] < o.x;
          g.drawImage(burrowSide(right), (o.out[0] - x0) * TS, (o.out[1] - y0) * TS);
        }
      }
      if (o.kind === 'lamp') g.drawImage(wallLamp(true), px, py);
      if (o.kind === 'board') g.drawImage(boardTile(), px, py);
      if (o.kind === 'mine') g.drawImage(minePortal(), px - TS, py);
      if (o.kind === 'grate' && sim.tiles[o.y * w.w + o.x] !== Tile.Grate) {
        g.drawImage(floorTile(bandAt(w, o.y).def.id, 1), px, py);
        g.drawImage(grateTile(true), px, py);
      }
    }
    hit = { c, snap, sig };
    this.chunks.set(key, hit);
    return c;
  }

  // ---- Герой ------------------------------------------------------------

  private drawHero(sim: Sim, gear: Gear, left: number, top: number): void {
    const g = this.bctx;
    const h = sim.hero;
    const px = this.q(h.x * TS - left);
    const py = this.q(h.y * TS - top);
    // Тень.
    const sprite = spritesReady();
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath();
    g.ellipse(px, py + (sprite ? 2 : 3), sprite ? 5 : 6, 2, 0, 0, Math.PI * 2);
    g.fill();
    if (sprite && this.drawHeroSprite(sim, gear, px, py, left, top)) return;
    if (h.mode === 'dead' || h.mode === 'dying') {
      const img = heroFrame(gear, 'down', 'dead', 0, false);
      g.drawImage(img, px - 8, py - 18);
      return;
    }
    const f = h.face;
    const c = Math.cos(f);
    const s = Math.sin(f);
    const dir: Dir = Math.abs(c) > Math.abs(s) * 1.15 ? 'side' : s < 0 ? 'up' : 'down';
    const leftFace = c < 0;
    const speed = Math.hypot(h.vx, h.vy);
    let anim: HeroAnim = speed > 0.6 ? 'walk' : 'idle';
    if (h.mode === 'attack' || h.mode === 'heavy' || h.mode === 'skill') anim = 'attack';
    if (h.mode === 'dash') anim = 'dash';
    const frame =
      anim === 'walk'
        ? Math.floor(h.walk * 2.4) % heroFrames('walk')
        : anim === 'idle'
          ? Math.floor(this.time * 1.6) % 2
          : anim === 'attack'
            ? h.t < 0.08
              ? 0
              : 1
            : 0;
    // Мигает только неуязвимость после укуса. Рывок тоже даёт неуязвимость,
    // и мигание на нём выглядело как исчезновение — отсюда «телепорт».
    const blink =
      h.mode !== 'dash' && h.inv > 0.08 && h.inv < 0.5 && Math.floor(this.time * 20) % 2 === 0;
    const img =
      h.flash > 0
        ? heroFlash(gear, dir, anim, frame, leftFace)
        : heroFrame(gear, dir, anim, frame, leftFace);
    // Шлейф рывка: силуэты остаются на пути и тают — глаз видит, КУДА
    // пролетел герой, а не что он пропал в одном месте и возник в другом.
    if (h.mode === 'dash') {
      this.ghostT -= this.dt;
      if (this.ghostT <= 0) {
        this.ghostT = 0.03;
        this.ghosts.push({
          x: h.x,
          y: h.y,
          img: heroFlash(gear, dir, anim, frame, leftFace),
          life: 0,
          top: 19,
        });
        this.puff(h.x, h.y + 0.25, 'rgba(170,150,125,0.55)', 1);
      }
    } else this.ghostT = 0;
    this.drawGhosts(left, top);
    // Оружие: за спиной, если смотрит вверх.
    const behind = dir === 'up';
    if (behind) this.drawWeapon(sim, gear, px, py);
    if (!blink || h.flash > 0) g.drawImage(img, px - 8, py - 19);
    if (!behind) this.drawWeapon(sim, gear, px, py);
    // Набор тяжёлого удара: кольцо растёт.
    if (h.mode === 'charge') {
      g.strokeStyle = h.charge >= 1 ? '#ffe08a' : 'rgba(255,255,255,0.7)';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(px + 0.5, py - 6.5, 4 + h.charge * 7, 0, Math.PI * 2);
      g.stroke();
    }
  }

  private drawGhosts(left: number, top: number): void {
    if (!this.ghosts.length) return;
    const g = this.bctx;
    const keep: Ghost[] = [];
    for (const gh of this.ghosts) {
      gh.life += this.dt;
      if (gh.life >= 0.24) continue;
      keep.push(gh);
      g.globalAlpha = 0.38 * (1 - gh.life / 0.24);
      g.drawImage(gh.img, this.q(gh.x * TS - left) - 8, this.q(gh.y * TS - top) - gh.top);
    }
    g.globalAlpha = 1;
    this.ghosts = keep;
  }

  /** Сторона взгляда с запасом: по диагонали герой не мигает между боком и спиной. */
  private heroDir: Dir4 = 'down';

  private dir4(ang: number): Dir4 {
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const side = Math.abs(c) > Math.abs(s);
    const prevSide = this.heroDir === 'left' || this.heroDir === 'right';
    // Меняем ось, только когда новая перевесила заметно.
    const keepAxis = side === prevSide || Math.abs(Math.abs(c) - Math.abs(s)) < 0.18;
    const useSide = keepAxis ? prevSide : side;
    this.heroDir = useSide ? (c < 0 ? 'left' : 'right') : s < 0 ? 'up' : 'down';
    return this.heroDir;
  }

  /**
   * Герой из набора: четыре стороны, шаг в 4 кадра по ПРОЙДЕННОМУ пути (ноги
   * не скользят по полу при любой скорости), поза удара, прыжок на рывке.
   * false — кадра нет, пусть рисует прежний герой.
   */
  private drawHeroSprite(
    sim: Sim,
    gear: Gear,
    px: number,
    py: number,
    left: number,
    top: number,
  ): boolean {
    const g = this.bctx;
    const h = sim.hero;
    const tier = gear.robe.tier;
    if (h.mode === 'dead' || h.mode === 'dying') {
      const img = heroSprite(tier, 'down', 0, h.flash > 0);
      if (!img) return false;
      // Лёг на бок: головой в сторону, лицом к нам.
      g.save();
      g.translate(px, py - 3);
      g.rotate(-Math.PI / 2);
      g.drawImage(img, -8, -8);
      g.restore();
      return true;
    }
    const attacking = h.mode === 'attack' || h.mode === 'heavy' || h.mode === 'skill';
    let dir = this.dir4(h.face);
    // Вихрь — оборот на месте: сторона меняется восемь раз за умение.
    if (h.mode === 'skill') {
      const spin: Dir4[] = ['down', 'left', 'up', 'right'];
      dir = spin[Math.floor((h.t / SKILL.dur) * 8) % 4];
    }
    const speed = Math.hypot(h.vx, h.vy);
    let row = speed > 0.6 ? ((Math.floor(h.walk / 0.36) % 4) + 4) % 4 : 0;
    if (attacking) row = ROW.attack;
    if (h.mode === 'dash') row = ROW.jump;
    const img = heroSprite(tier, dir, row, h.flash > 0);
    if (!img) return false;
    if (h.mode === 'dash') {
      this.ghostT -= this.dt;
      if (this.ghostT <= 0) {
        this.ghostT = 0.03;
        const ghost = heroSprite(tier, dir, row, true);
        if (ghost) this.ghosts.push({ x: h.x, y: h.y, img: ghost, life: 0, top: 13 });
        this.puff(h.x, h.y + 0.25, 'rgba(170,150,125,0.55)', 1);
      }
    } else this.ghostT = 0;
    this.drawGhosts(left, top);
    const blink =
      h.mode !== 'dash' && h.inv > 0.08 && h.inv < 0.5 && Math.floor(this.time * 20) % 2 === 0;
    const blade = this.bladeAngle(h);
    // Клинок, поднятый вверх, — за головой; остальное — перед телом.
    const behind = blade !== null && (Math.sin(blade) < -0.35 || dir === 'up');
    // Кулак — там, куда тянется рука в позе удара: по ходу удара от груди.
    const aim = h.mode === 'charge' ? h.face + Math.PI : h.aim;
    const hx = px + Math.cos(aim) * 5;
    const hy = py - 4 + Math.sin(aim) * 4;
    if (blade !== null && behind) this.drawBlade(gear, hx, hy, blade);
    if (!blink || h.flash > 0) g.drawImage(img, px - 8, py - 13);
    if (blade !== null && !behind) this.drawBlade(gear, hx, hy, blade);
    if (h.mode === 'charge') {
      g.strokeStyle = h.charge >= 1 ? '#ffe08a' : 'rgba(255,255,255,0.7)';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(px + 0.5, py - 4.5, 4 + h.charge * 7, 0, Math.PI * 2);
      g.stroke();
    }
    return true;
  }

  /** Куда смотрит остриё; null — клинок убран (в покое и на ходу его нет). */
  private bladeAngle(h: Sim['hero']): number | null {
    if (h.mode === 'attack' || h.mode === 'heavy') {
      const heavy = h.mode === 'heavy';
      const st = heavy ? SWORD.heavy : SWORD.steps[Math.max(0, Math.min(2, h.step))];
      const arc = heavy ? SWORD.heavy.arc : SWORD.arc * (st as { arc: number }).arc;
      // Замах до задевающей фазы, дальше — до конца дуги с торможением.
      const k = Math.min(1, Math.max(0, h.t / st.to));
      const dir = heavy ? -1 : h.step % 2 === 1 ? -1 : 1;
      return h.aim - (dir * arc) / 2 + dir * arc * (1 - Math.pow(1 - k, 3));
    }
    if (h.mode === 'skill') return h.aim + (h.t / SKILL.dur) * Math.PI * 2;
    if (h.mode === 'charge') {
      // Замах за плечо: назад и вверх, за головой — лицо не закрыто.
      const back = h.face + Math.PI;
      const a = Math.atan2(Math.sin(back) - 0.8, Math.cos(back));
      return a + Math.sin(this.time * 40) * 0.04 * h.charge;
    }
    return null;
  }

  /** Клинок в кулаке (hx, hy): рукоять в руке, остриё по углу `a`. */
  private drawBlade(gear: Gear, hx: number, hy: number, a: number): void {
    const img = bladeSprite(gear.weapon.tier);
    if (!img) return;
    const g = this.bctx;
    g.save();
    // Клинки набора нарисованы остриём ВНИЗ (удар по умолчанию — к нам), так
    // что «вниз» картинки поворачиваем на угол удара; навершие — за кулаком.
    g.translate(hx, hy);
    g.rotate(a - Math.PI / 2);
    g.drawImage(img, -Math.floor(img.width / 2), -3);
    g.restore();
  }

  private drawWeapon(sim: Sim, gear: Gear, px: number, py: number): void {
    const g = this.bctx;
    const h = sim.hero;
    const img = weaponArt(gear.weapon.tier);
    let ang: number;
    if (h.mode === 'attack' || h.mode === 'heavy') {
      const heavy = h.mode === 'heavy';
      const st = heavy ? SWORD.heavy : SWORD.steps[Math.max(0, h.step)];
      const arc = heavy
        ? SWORD.heavy.arc
        : SWORD.arc * (SWORD.steps[Math.max(0, h.step)]?.arc ?? 1);
      const k = Math.min(1, Math.max(0, (h.t - st.from * 0.6) / (st.to - st.from * 0.6)));
      const dir = h.step % 2 === 1 ? -1 : 1;
      ang = h.aim - (dir * arc) / 2 + dir * arc * (1 - Math.pow(1 - k, 3));
    } else if (h.mode === 'skill') {
      ang = h.aim;
    } else if (h.mode === 'charge') {
      ang = h.face + Math.PI * 0.85;
    } else {
      // В покое клинок опущен у бедра.
      ang = Math.cos(h.face) < 0 ? Math.PI * 0.62 : Math.PI * 0.38;
    }
    g.save();
    g.translate(px, py - 7);
    g.rotate(ang);
    g.drawImage(img, 3 - 2, -Math.floor(img.height / 2));
    g.restore();
  }

  // ---- Мобы -------------------------------------------------------------

  private drawMob(sim: Sim, m: Mob, left: number, top: number): void {
    const g = this.bctx;
    const px = this.q(m.x * TS - left);
    const py = this.q(m.y * TS - top);
    const boss = m.kind === 'king' || m.kind === 'kinglet';
    const leftFace = Math.cos(m.face) < 0;
    let anim: MobAnim = 'run0';
    if (m.mode === 'dying' || m.mode === 'escape') anim = 'dead';
    else if (m.mode === 'sleep') anim = 'sleep';
    else if (
      m.mode === 'windup' ||
      m.mode === 'rollAim' ||
      m.mode === 'whipAim' ||
      m.mode === 'plant' ||
      m.mode === 'summon'
    )
      anim = 'wind';
    else if (m.mode === 'recover' && m.t < 0.12) anim = 'bite';
    else anim = Math.floor((this.time + m.id) * 10) % 2 === 0 ? 'run0' : 'run1';
    const look = m.albino ? 'albino' : m.elite ? 'elite' : 'normal';
    const img = mobArt(m.kind, look, anim, leftFace, m.flash > 0);
    // Появление: из норы выползает, со свода падает.
    let dy = 0;
    let alpha = 1;
    // Ждёт очереди в норе — не видна; выползая, проявляется из темноты дыры.
    if (m.mode === 'emerge') {
      if (m.t <= 0) return;
      alpha = Math.min(1, m.t / 0.25);
    }
    if (m.mode === 'drop') {
      // До своей очереди тень только намечается: радиус эллипса не бывает
      // отрицательным (канва на нём падает).
      const k = Math.max(0, Math.min(1, m.t / 0.55));
      dy = -(1 - k * k) * 40;
      // Тень под падающей растёт.
      g.fillStyle = `rgba(0,0,0,${0.15 + 0.3 * k})`;
      g.beginPath();
      g.ellipse(px, py + 2, 2 + 4 * k, 1 + 1.5 * k, 0, 0, Math.PI * 2);
      g.fill();
      if (m.t < 0) return;
    } else {
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.beginPath();
      g.ellipse(px, py + 2, img.width * 0.32, boss ? 4 : 2, 0, 0, Math.PI * 2);
      g.fill();
    }
    if (m.mode === 'dying') alpha = Math.max(0, 1 - Math.max(0, m.t - 0.35) / 0.35);
    // Замах: мелкая дрожь, красный отсвет.
    let jx = 0;
    if (m.mode === 'windup' || m.mode === 'rollAim' || m.mode === 'whipAim')
      jx = Math.round(Math.sin(this.time * 70 + m.id) * (boss ? 1.4 : 0.8));
    // Король катится — клубок вращается.
    g.globalAlpha = alpha;
    if (m.mode === 'roll') {
      g.save();
      g.translate(px, py - img.height / 2 + 2);
      g.rotate(this.time * 14 * (Math.cos(m.dir) >= 0 ? 1 : -1));
      g.drawImage(img, -img.width / 2, -img.height / 2);
      g.restore();
    } else {
      g.drawImage(img, px - Math.round(img.width / 2) + jx, py + 3 - img.height + dy);
    }
    g.globalAlpha = 1;
    if (
      !boss &&
      m.mode !== 'dying' &&
      m.mode !== 'sleep' &&
      m.mode !== 'escape' &&
      m.mode !== 'drop'
    ) {
      const fat = m.kind === 'fatrat';
      const ex = fat ? 14 : 11;
      const ey = (fat ? 6 : 5) + (anim === 'wind' ? 1 : 0);
      const sx0 = px - Math.round(img.width / 2) + jx;
      const sy0 = py + 3 - img.height + dy;
      this.eyes.push({
        x: sx0 + (leftFace ? img.width - 1 - ex : ex),
        y: sy0 + ey,
        c: m.kind === 'goldrat' ? '#ffe070' : m.albino ? '#ff9cb0' : '#ff3a28',
      });
    }
    // Полоска здоровья — только у раненых, и у элиты с именем.
    if (!boss && m.hp < m.maxHp && m.hp > 0) {
      const w = m.kind === 'fatrat' ? 14 : 10;
      const x = px - w / 2;
      const y = py + 3 - img.height - 3 + dy;
      g.fillStyle = 'rgba(0,0,0,0.7)';
      g.fillRect(x - 1, y - 1, w + 2, 3);
      g.fillStyle = m.elite ? '#ffcc40' : '#e04a3a';
      g.fillRect(x, y, Math.max(1, Math.round((w * m.hp) / m.maxHp)), 1);
    }
  }

  // ---- Метки на полу: всё, что бьёт, сперва предупреждает -----------------

  private drawTelegraphs(sim: Sim, left: number, top: number): void {
    const g = this.bctx;
    for (const m of sim.mobs) {
      const px = m.x * TS - left;
      const py = m.y * TS - top;
      if (m.mode === 'windup') {
        const k = Math.min(1, m.t / MOBS[m.kind].windup);
        const reach = (MOBS[m.kind].reach + m.r + 0.2) * TS;
        g.fillStyle = `rgba(255,60,40,${0.18 + 0.3 * k})`;
        g.beginPath();
        g.moveTo(px, py);
        g.arc(px, py, reach, m.face - 0.6, m.face + 0.6);
        g.closePath();
        g.fill();
      }
      if (m.mode === 'rollAim') {
        // Стрела качения: полоса по направлению, наливается к броску.
        const k = Math.min(1, m.t / 0.8);
        g.save();
        g.translate(px, py);
        g.rotate(m.dir);
        g.fillStyle = `rgba(255,50,30,${0.15 + 0.35 * k})`;
        g.fillRect(0, -m.r * TS, 7 * TS, m.r * 2 * TS);
        g.fillStyle = `rgba(255,120,80,${0.5 * k})`;
        for (let i = 1; i < 7; i++) g.fillRect(i * TS - 2, -2, 3, 4);
        g.restore();
      }
      if (m.mode === 'whipAim') {
        const k = Math.min(1, m.t / 0.7);
        const r = (m.kind === 'kinglet' ? 1.7 : 2.1) * TS;
        g.strokeStyle = `rgba(255,60,40,${0.5 + 0.4 * k})`;
        g.lineWidth = 1;
        g.beginPath();
        g.arc(px, py, r, 0, Math.PI * 2);
        g.stroke();
        g.fillStyle = `rgba(255,60,40,${0.12 + 0.25 * k})`;
        g.beginPath();
        g.arc(px, py, r * k, 0, Math.PI * 2);
        g.fill();
      }
    }
    for (const b of sim.bombs) {
      const k = 1 - Math.min(1, b.fuse / 1.6);
      g.strokeStyle = `rgba(255,120,40,${0.3 + 0.6 * k})`;
      g.lineWidth = 1;
      g.beginPath();
      g.arc(b.x * TS - left, b.y * TS - top, b.r * TS, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = `rgba(255,90,30,${0.08 + 0.2 * k})`;
      g.fill();
    }
    for (const p of sim.props) {
      if (p.kind === 'powder' && p.fuse > 0) {
        g.strokeStyle = 'rgba(255,120,40,0.9)';
        g.beginPath();
        g.arc(p.x * TS - left, p.y * TS - top, 2.4 * TS, 0, Math.PI * 2);
        g.stroke();
      }
    }
  }

  // ---- Частицы, удары, кольца ---------------------------------------------

  private drawParticles(dt: number, left: number, top: number): void {
    const g = this.bctx;
    const keep: Particle[] = [];
    for (const p of this.parts) {
      p.life += dt;
      if (p.life >= p.max) continue;
      if (p.soft) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.size += dt * 4;
        const a = 1 - p.life / p.max;
        g.globalAlpha = a * 0.5;
        g.fillStyle = p.color;
        g.fillRect(
          this.q(p.x * TS - left - p.size / 2),
          this.q(p.y * TS - top - p.size / 2),
          Math.round(p.size),
          Math.round(p.size),
        );
      } else {
        p.vz -= 22 * dt;
        p.z += p.vz * dt;
        if (p.z <= 0) {
          p.z = 0;
          p.vz = Math.abs(p.vz) > 2 ? -p.vz * 0.35 : 0;
          p.vx *= 0.6;
          p.vy *= 0.6;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const a = p.life > p.max * 0.7 ? 1 - (p.life - p.max * 0.7) / (p.max * 0.3) : 1;
        g.globalAlpha = a;
        g.fillStyle = p.color;
        g.fillRect(
          this.q(p.x * TS - left),
          this.q((p.y - p.z * 0.5) * TS - top - 4),
          p.size,
          p.size,
        );
      }
      keep.push(p);
    }
    g.globalAlpha = 1;
    this.parts = keep;
  }

  private drawSlashes(sim: Sim, dt: number, left: number, top: number): void {
    const g = this.bctx;
    const keep: Slash[] = [];
    for (const s of this.slashes) {
      s.life += dt;
      if (s.life >= s.max) continue;
      keep.push(s);
      const k = s.life / s.max;
      // Серп из набора: смотрит вправо и идёт снизу вверх — поворачиваем на
      // угол удара и отражаем, если удар идёт сверху вниз. Третий удар серии —
      // двойной серп, тяжёлый — тройной.
      const id: FxId = s.heavy ? 11 : s.step === 2 ? 10 : 8;
      const img = fxFrame(id, k * fxCount(id));
      if (img) {
        const sc = (s.reach * TS) / 16;
        g.save();
        g.translate(
          this.q(sim.hero.x * TS - left + Math.cos(s.ang) * 2),
          this.q(sim.hero.y * TS - top - 5 + Math.sin(s.ang) * 2),
        );
        g.rotate(s.ang);
        g.scale(sc, s.flip ? sc : -sc);
        g.drawImage(img, -16, -16);
        g.restore();
        continue;
      }
      // След клинка идёт за героем, а не висит в воздухе.
      const hx = sim.hero.x * TS - left;
      const hy = sim.hero.y * TS - top - 6;
      const r0 = s.reach * TS * 0.35;
      const r1 = s.reach * TS * (s.heavy ? 1.05 : 1);
      const dir = s.flip ? -1 : 1;
      const a0 = s.ang - (dir * s.arc) / 2;
      const sweep = s.arc * Math.min(1, k * 2.2);
      const a1 = a0 + dir * sweep;
      g.globalAlpha = (1 - k) * (s.heavy ? 0.95 : 0.8);
      g.fillStyle = s.heavy ? '#fff2c0' : '#ffffff';
      g.beginPath();
      g.arc(hx, hy, r1, Math.min(a0, a1), Math.max(a0, a1));
      g.arc(hx, hy, r0 + (r1 - r0) * 0.55, Math.max(a0, a1), Math.min(a0, a1), true);
      g.closePath();
      g.fill();
      g.globalAlpha = 1;
    }
    this.slashes = keep;
  }

  private drawRings(dt: number, left: number, top: number): void {
    const g = this.bctx;
    const keep: Ring[] = [];
    for (const r of this.rings) {
      r.life += dt;
      if (r.life >= r.max) continue;
      keep.push(r);
      const k = r.life / r.max;
      g.globalAlpha = 1 - k;
      g.strokeStyle = r.color;
      g.lineWidth = 1;
      g.beginPath();
      g.arc(r.x * TS - left, r.y * TS - top, r.r * TS * (0.3 + 0.7 * k), 0, Math.PI * 2);
      g.stroke();
    }
    g.globalAlpha = 1;
    this.rings = keep;
  }

  private drawFx(sim: Sim, dt: number, left: number, top: number): void {
    if (!this.fx.length) return;
    const g = this.bctx;
    const keep: Fx[] = [];
    for (const f of this.fx) {
      f.life += dt;
      if (f.life >= f.max) continue;
      keep.push(f);
      const img = fxFrame(f.id, (f.life / f.max) * fxCount(f.id));
      if (!img) continue;
      const bx = f.follow ? sim.hero.x * TS + f.dx : f.x * TS;
      const by = f.follow ? sim.hero.y * TS + f.dy : f.y * TS;
      g.save();
      g.globalAlpha = f.alpha;
      g.translate(this.q(bx - left), this.q(by - top));
      if (f.ang) g.rotate(f.ang);
      g.scale(f.scale, f.flip ? -f.scale : f.scale);
      g.drawImage(img, -16, -16);
      g.restore();
    }
    this.fx = keep;
  }

  // ---- Свет -------------------------------------------------------------

  private drawLight(sim: Sim, left: number, top: number, dt: number): void {
    const l = this.lctx;
    const band = bandAt(sim.world, sim.hero.y);
    const amb = areaOf(band.def.id).ambient;
    // Маска света — целыми игровыми пикселями, на пиксель шире кадра; на
    // экран она ложится со сдвигом и сглаживанием: свет мягкий, а не лесенкой.
    const lx = Math.floor(left) - 1;
    const ly = Math.floor(top) - 1;
    const LW = this.light.width;
    const LH = this.light.height;
    l.globalCompositeOperation = 'source-over';
    l.clearRect(0, 0, LW, LH);
    l.fillStyle = `rgba(6,4,10,${1 - amb})`;
    l.fillRect(0, 0, LW, LH);
    l.globalCompositeOperation = 'destination-out';
    this.cutExplored(sim, lx, ly);
    const blob = lightBlob();
    const hole = (x: number, y: number, r: number, a = 1) => {
      const px = x * TS - lx;
      const py = y * TS - ly;
      const rr = r * TS;
      if (px + rr < 0 || py + rr < 0 || px - rr > LW || py - rr > LH) return;
      l.globalAlpha = a;
      l.drawImage(blob, px - rr, py - rr, rr * 2, rr * 2);
    };
    const lights = sim.world.lights;
    for (const li of lights) {
      if (li.lamp && !sim.lit.has(li.lamp)) continue;
      const flick =
        1 + Math.sin(this.time * 7 + li.x * 3.1) * 0.03 + noise(this.time * 3, li.y) * 0.04;
      hole(li.x, li.y, li.r * flick);
    }
    // Фонарь героя.
    const h = sim.hero;
    hole(h.x, h.y - 0.4, sim.stats.light);
    // Взрывы светят.
    this.blasts = this.blasts.filter((b) => (b.life -= dt) > 0);
    for (const b of this.blasts) hole(b.x, b.y, b.r, Math.min(1, b.life * 4));
    // Добыча и золотая крыса светятся сами.
    for (const d of sim.drops)
      if (d.kind === 'coin' || d.kind === 'token' || d.kind === 'key' || d.kind === 'crown')
        hole(d.x, d.y, 0.9, 0.6);
    for (const m of sim.mobs) if (m.kind === 'goldrat' || m.albino) hole(m.x, m.y, 1.8, 0.7);
    l.globalAlpha = 1;
    l.globalCompositeOperation = 'source-over';
    const g = this.bctx;
    g.imageSmoothingEnabled = true;
    g.drawImage(this.light, lx - left, ly - top);
    g.imageSmoothingEnabled = false;
    // Тёплый подсвет от ламп — сложением, слабый.
    g.globalCompositeOperation = 'lighter';
    const tints: Record<string, HTMLCanvasElement> = {
      warm: glowBlob('rgba(255,170,80,0.22)'),
      cold: glowBlob('rgba(140,190,255,0.16)'),
      teal: glowBlob('rgba(90,230,200,0.18)'),
      red: glowBlob('rgba(255,70,50,0.2)'),
    };
    for (const li of lights) {
      if (li.lamp && !sim.lit.has(li.lamp)) continue;
      const px = li.x * TS - left;
      const py = li.y * TS - top;
      const rr = li.r * TS * 0.7;
      if (px + rr < 0 || py + rr < 0 || px - rr > this.gw || py - rr > this.gh) continue;
      g.drawImage(tints[li.tint] ?? tints.warm, px - rr, py - rr, rr * 2, rr * 2);
    }
    for (const b of this.blasts) {
      const rr = b.r * TS;
      g.drawImage(
        glowBlob('rgba(255,150,60,0.6)'),
        b.x * TS - left - rr,
        b.y * TS - top - rr,
        rr * 2,
        rr * 2,
      );
    }
    g.globalCompositeOperation = 'source-over';
  }

  /**
   * Разведанное — светлым. Маска по клеткам рисуется в крошечную канву (точка
   * на клетку) и растягивается на свет со сглаживанием: край разведанного
   * плавный, а не лесенкой из квадратов 16×16.
   */
  private cutExplored(sim: Sim, lx: number, ly: number): void {
    const w = sim.world;
    const tx0 = Math.floor(lx / TS) - 1;
    const ty0 = Math.floor(ly / TS) - 1;
    const tw = Math.ceil(this.light.width / TS) + 3;
    const th = Math.ceil(this.light.height / TS) + 3;
    const c = (this.fogCv ??= document.createElement('canvas'));
    if (c.width !== tw || c.height !== th) {
      c.width = tw;
      c.height = th;
    }
    const fx = c.getContext('2d')!;
    const img = fx.createImageData(tw, th);
    const d = img.data;
    let any = false;
    for (let j = 0; j < th; j++) {
      const y = ty0 + j;
      if (y < 0 || y >= w.h) continue;
      const band = bandAt(w, y);
      const bits = sim.fog[band.def.id];
      if (!bits) continue;
      for (let i = 0; i < tw; i++) {
        const x = tx0 + i;
        if (x < 0 || x >= w.w || !fogGet(bits, x, y - band.top, w.w)) continue;
        d[(j * tw + i) * 4 + 3] = 255;
        any = true;
      }
    }
    if (!any) return;
    fx.putImageData(img, 0, 0);
    const l = this.lctx;
    l.globalAlpha = EXPLORED_LIT;
    l.imageSmoothingEnabled = true;
    l.drawImage(c, tx0 * TS - lx, ty0 * TS - ly, tw * TS, th * TS);
    l.globalAlpha = 1;
  }

  // ---- Цифры — на экранной канве, чёткие -------------------------------

  private drawFloats(dt: number, left: number, top: number): void {
    const v = this.vctx;
    const keep: Float[] = [];
    const base = Math.round(this.scale * 2.2);
    for (const f of this.floats) {
      f.life += dt;
      if (f.life >= f.max) continue;
      keep.push(f);
      const k = f.life / f.max;
      const rise = (1 - (1 - k) * (1 - k)) * 0.9;
      const gx = (f.x + f.vx * k) * TS - left;
      const gy = (f.y - rise) * TS - top;
      const x = this.ox + gx * this.scale;
      const y = this.oy + gy * this.scale;
      const pop = k < 0.15 ? 0.7 + (k / 0.15) * 0.5 : 1.2 - Math.min(0.2, (k - 0.15) * 0.6);
      const size = Math.round(base * f.size * pop);
      v.globalAlpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      v.font = `900 ${size}px system-ui, sans-serif`;
      v.textAlign = 'center';
      v.lineWidth = Math.max(2, Math.round(size / 5));
      v.strokeStyle = 'rgba(12,8,6,0.95)';
      v.strokeText(f.text, x, y);
      v.fillStyle = f.color;
      v.fillText(f.text, x, y);
    }
    v.globalAlpha = 1;
    this.floats = keep;
  }

  /** Сбросить кеш карты — после смены мира. */
  invalidate(): void {
    this.chunks.clear();
  }
}

export type { MobId, World };
