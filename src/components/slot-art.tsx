// Символы автомата, нарисованные вручную (инлайновый SVG, без картинок).
// Системные эмодзи выглядят как переписка, а не как игровой автомат: здесь у
// каждого символа объёмная заливка, тёмная обводка, блик и падающая тень —
// приёмы, которыми рисуют символы в настоящих слотах.

import type { SlotSymbolId } from '@/types';

type Props = { id: SlotSymbolId; size?: number };

/** Общие градиенты и фильтры: один раз на документ, дальше — по ссылке. */
export function SlotArtDefs() {
  return (
    <svg className="slot-defs" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="sg-cherry" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ff5d6e" />
          <stop offset="45%" stopColor="#e11d3c" />
          <stop offset="100%" stopColor="#8c0a22" />
        </linearGradient>
        <linearGradient id="sg-lemon" x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0%" stopColor="#fff07a" />
          <stop offset="50%" stopColor="#ffcc2e" />
          <stop offset="100%" stopColor="#e28a0c" />
        </linearGradient>
        <linearGradient id="sg-grape" x1="0" y1="0" x2="0.2" y2="1">
          <stop offset="0%" stopColor="#c08bff" />
          <stop offset="50%" stopColor="#8b46e0" />
          <stop offset="100%" stopColor="#4d1f8c" />
        </linearGradient>
        <linearGradient id="sg-gold" x1="0" y1="0" x2="0.25" y2="1">
          <stop offset="0%" stopColor="#fff3b0" />
          <stop offset="40%" stopColor="#ffc93c" />
          <stop offset="100%" stopColor="#c47f05" />
        </linearGradient>
        <linearGradient id="sg-leaf" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#7ddc63" />
          <stop offset="100%" stopColor="#2c7a25" />
        </linearGradient>
        <linearGradient id="sg-seven" x1="0" y1="0" x2="0.2" y2="1">
          <stop offset="0%" stopColor="#ff7a7a" />
          <stop offset="45%" stopColor="#e6213c" />
          <stop offset="100%" stopColor="#8e0a1f" />
        </linearGradient>
        <linearGradient id="sg-ice-top" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#eafbff" />
          <stop offset="100%" stopColor="#9fe2ff" />
        </linearGradient>
        <linearGradient id="sg-ice-left" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#7fd2f7" />
          <stop offset="100%" stopColor="#3b8fd0" />
        </linearGradient>
        <linearGradient id="sg-ice-right" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#59b4e8" />
          <stop offset="100%" stopColor="#1f5f9e" />
        </linearGradient>
        <linearGradient id="sg-coin" x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0%" stopColor="#ffe9a3" />
          <stop offset="45%" stopColor="#ffc53c" />
          <stop offset="100%" stopColor="#b97a05" />
        </linearGradient>
        <radialGradient id="sg-shine" cx="0.35" cy="0.3" r="0.5">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.75" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        {/* Радиальные заливки дают выпуклость: свет слева-сверху, тень справа-снизу */}
        <radialGradient id="sg-cherry-r" cx="0.32" cy="0.28" r="0.78">
          <stop offset="0%" stopColor="#ff8d97" />
          <stop offset="38%" stopColor="#ef2440" />
          <stop offset="100%" stopColor="#780a1d" />
        </radialGradient>
        <radialGradient id="sg-lemon-r" cx="0.32" cy="0.26" r="0.8">
          <stop offset="0%" stopColor="#fff9c4" />
          <stop offset="42%" stopColor="#ffcf35" />
          <stop offset="100%" stopColor="#c9760a" />
        </radialGradient>
        <radialGradient id="sg-grape-r" cx="0.33" cy="0.28" r="0.8">
          <stop offset="0%" stopColor="#d3a9ff" />
          <stop offset="45%" stopColor="#8b46e0" />
          <stop offset="100%" stopColor="#3d1573" />
        </radialGradient>
        <linearGradient id="sg-gold-deep" x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0%" stopColor="#ffe89a" />
          <stop offset="45%" stopColor="#f0a90f" />
          <stop offset="100%" stopColor="#8f5a02" />
        </linearGradient>
        <filter id="sg-drop" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow
            dx="0"
            dy="1.6"
            stdDeviation="1.4"
            floodColor="#2a1206"
            floodOpacity="0.5"
          />
        </filter>
      </defs>
    </svg>
  );
}

/** Обводка не чёрная, а «свой» цвет символа, уведённый в тень: так контур
 *  не выглядит наклейкой поверх рисунка. */
const OUTLINE = '#2a1206';
const O_CHERRY = '#3d0509';
const O_LEMON = '#4a2a03';
const O_GRAPE = '#22083f';
const O_GOLD = '#4a2a03';
const O_ICE = '#08243f';

function Cherry() {
  return (
    <g filter="url(#sg-drop)">
      {/* стебли */}
      <path
        d="M31 12c-6 8-13 12-17 22M31 12c3 9 8 14 13 22"
        stroke="#3f7d2a"
        strokeWidth="3.2"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M31 12c5-5 12-6 16-3-3 6-9 8-16 3z"
        fill="url(#sg-leaf)"
        stroke={OUTLINE}
        strokeWidth="1.6"
      />
      <circle cx="44" cy="46" r="12" fill="url(#sg-cherry-r)" stroke={O_CHERRY} strokeWidth="2.6" />
      <circle
        cx="21"
        cy="43"
        r="13.5"
        fill="url(#sg-cherry-r)"
        stroke={O_CHERRY}
        strokeWidth="2.6"
      />
      {/* блик и отражённый свет снизу — ягода становится шаром */}
      <ellipse
        cx="16"
        cy="37"
        rx="5"
        ry="3.4"
        fill="#fff"
        opacity="0.75"
        transform="rotate(-28 16 37)"
      />
      <ellipse
        cx="39"
        cy="41"
        rx="3.6"
        ry="2.5"
        fill="#fff"
        opacity="0.6"
        transform="rotate(-28 39 41)"
      />
      <path
        d="M13 50a13.5 13.5 0 0 0 15 4"
        stroke="#ff9aa4"
        strokeWidth="2"
        opacity="0.35"
        fill="none"
      />
    </g>
  );
}

function Lemon() {
  return (
    <g filter="url(#sg-drop)">
      <g transform="rotate(-14 32 35)">
        {/* Кривые сходятся в точки слева и справа — характерные «носики» лимона */}
        <path
          d="M6 35C10 23 19 17.5 32 17.5S54 23 58 35c-4 12-13 17.5-26 17.5S10 47 6 35z"
          fill="url(#sg-lemon-r)"
          stroke={O_LEMON}
          strokeWidth="2.6"
          strokeLinejoin="round"
        />
        <ellipse
          cx="23"
          cy="27"
          rx="9.5"
          ry="5"
          fill="#fff"
          opacity="0.6"
          transform="rotate(-18 23 27)"
        />
        <path
          d="M16 44c7 4 18 4 27 0"
          stroke="#b86c06"
          strokeWidth="2.2"
          opacity="0.28"
          fill="none"
        />
        <path
          d="M48 24c3 2.6 5 5.8 6 8.6"
          stroke="#fff"
          strokeWidth="2"
          opacity="0.25"
          fill="none"
        />
      </g>
      <path
        d="M18 18c4-3 8-2 10 1"
        stroke="#3f7d2a"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M28 19c5-4 11-4 14-1-4 5-10 5-14 1z"
        fill="url(#sg-leaf)"
        stroke={OUTLINE}
        strokeWidth="1.6"
      />
    </g>
  );
}

function Grape() {
  const berries: [number, number][] = [
    [32, 22],
    [23, 31],
    [41, 31],
    [32, 34],
    [18, 42],
    [46, 42],
    [27, 45],
    [37, 45],
    [32, 54],
  ];
  return (
    <g filter="url(#sg-drop)">
      <path
        d="M32 18c0-6 4-9 9-10"
        stroke="#3f7d2a"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M40 9c6-3 12-1 14 2-5 5-11 4-14-2z"
        fill="url(#sg-leaf)"
        stroke={OUTLINE}
        strokeWidth="1.6"
      />
      {berries.map(([cx, cy], i) => (
        <g key={i}>
          <circle
            cx={cx}
            cy={cy}
            r="8.4"
            fill="url(#sg-grape-r)"
            stroke={O_GRAPE}
            strokeWidth="2.2"
          />
          <ellipse cx={cx - 2.8} cy={cy - 3.2} rx="2.8" ry="1.9" fill="#fff" opacity="0.6" />
        </g>
      ))}
    </g>
  );
}

function Bell() {
  return (
    <g filter="url(#sg-drop)">
      {/* ушко */}
      <circle cx="32" cy="10" r="4" fill="url(#sg-gold-deep)" stroke={OUTLINE} strokeWidth="2.2" />
      {/* купол: шире и ниже — колокол читается даже в мелком размере */}
      <path
        d="M32 14c-10.5 0-18.5 8.4-18.5 19.6V42h37v-8.4C50.5 22.4 42.5 14 32 14z"
        fill="url(#sg-gold)"
        stroke={O_GOLD}
        strokeWidth="2.6"
        strokeLinejoin="round"
      />
      {/* юбка */}
      <path
        d="M11 42h42l3.6 5c1 1.4 0 3.4-1.8 3.4H9.2c-1.8 0-2.8-2-1.8-3.4z"
        fill="url(#sg-gold-deep)"
        stroke={O_GOLD}
        strokeWidth="2.6"
        strokeLinejoin="round"
      />
      <path
        d="M24 22c-4 4.6-6 10-6 15.6"
        stroke="#fff"
        strokeWidth="3.6"
        strokeLinecap="round"
        opacity="0.6"
        fill="none"
      />
      <path
        d="M43 25c2 3.4 3.2 7.4 3.2 11.4"
        stroke="#8f5a02"
        strokeWidth="2.6"
        strokeLinecap="round"
        opacity="0.45"
        fill="none"
      />
      <circle cx="32" cy="55" r="5.2" fill="url(#sg-gold)" stroke={OUTLINE} strokeWidth="2.2" />
      <ellipse cx="30" cy="53" rx="2" ry="1.3" fill="#fff" opacity="0.65" />
    </g>
  );
}

function Star() {
  const P = (r: number, i: number): [number, number] => {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    return [32 + r * Math.cos(a), 33 + r * Math.sin(a)];
  };
  const outer = Array.from({ length: 10 }, (_, i) => P(i % 2 === 0 ? 26 : 11, i));
  const pts = outer.map(([x, y]) => `${x},${y}`).join(' ');
  // Каждый луч делится надвое: левая половина светлая, правая — в тени.
  const facets = Array.from({ length: 5 }, (_, k) => {
    const tip = outer[k * 2];
    const left = outer[(k * 2 + 9) % 10];
    const right = outer[k * 2 + 1];
    return { k, tip, left, right };
  });
  return (
    <g filter="url(#sg-drop)">
      <polygon
        points={pts}
        fill="url(#sg-gold-deep)"
        stroke={O_GOLD}
        strokeWidth="2.6"
        strokeLinejoin="round"
      />
      {facets.map(({ k, tip, left }) => (
        <polygon
          key={k}
          points={`32,33 ${tip[0]},${tip[1]} ${left[0]},${left[1]}`}
          fill="#fff6c8"
          opacity="0.55"
        />
      ))}
      {facets.map(({ k, tip, right }) => (
        <polygon
          key={`r${k}`}
          points={`32,33 ${tip[0]},${tip[1]} ${right[0]},${right[1]}`}
          fill="#a86a02"
          opacity="0.28"
        />
      ))}
      <polygon points={pts} fill="none" stroke={O_GOLD} strokeWidth="2.6" strokeLinejoin="round" />
      <circle cx="32" cy="33" r="3.2" fill="#fff8d6" opacity="0.8" />
    </g>
  );
}

function Diamond() {
  return (
    <g filter="url(#sg-drop)">
      {/* корона */}
      <polygon
        points="32,10 52,26 12,26"
        fill="url(#sg-ice-top)"
        stroke={O_ICE}
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <polygon points="32,10 41,26 23,26" fill="#d8f4ff" stroke={O_ICE} strokeWidth="1.4" />
      {/* павильон */}
      <polygon
        points="12,26 32,56 32,26"
        fill="url(#sg-ice-left)"
        stroke={O_ICE}
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <polygon
        points="52,26 32,56 32,26"
        fill="url(#sg-ice-right)"
        stroke={O_ICE}
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <polygon points="23,26 32,56 41,26" fill="#8ad6f7" opacity="0.75" />
      <path d="M17 20l6-5" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" opacity="0.85" />
      {/* искра — обязательный атрибут «дорогого» камня */}
      <path
        d="M48 12l1.6 4.4L54 18l-4.4 1.6L48 24l-1.6-4.4L42 18l4.4-1.6z"
        fill="#fff"
        opacity="0.9"
      />
      <path d="M14 34l1 2.8L18 38l-3 1-1 2.8-1-2.8-3-1 3-1.2z" fill="#fff" opacity="0.6" />
    </g>
  );
}

function Seven() {
  return (
    <g filter="url(#sg-drop)">
      <path
        d="M15 12h34l-15 40h-12l13-29H15z"
        fill="url(#sg-seven)"
        stroke="#ffd44a"
        strokeWidth="3.4"
        strokeLinejoin="round"
      />
      <path
        d="M15 12h34l-15 40h-12l13-29H15z"
        fill="none"
        stroke={OUTLINE}
        strokeWidth="1.2"
        strokeLinejoin="round"
        opacity="0.85"
      />
      <path d="M20 17h20" stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity="0.6" />
      <path d="M33 30l-8 21" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" opacity="0.3" />
    </g>
  );
}

const ART: Record<SlotSymbolId, () => JSX.Element> = {
  cherry: Cherry,
  lemon: Lemon,
  grape: Grape,
  bell: Bell,
  star: Star,
  diamond: Diamond,
  seven: Seven,
};

/** Один символ барабана. */
export function SymbolArt({ id, size = 52 }: Props) {
  const Art = ART[id];
  return (
    <svg
      className="sym"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
    >
      <Art />
    </svg>
  );
}

/** Монета — валюта игры (вместо эмодзи 🪙). */
export function CoinIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      className="coin-ico"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="32" cy="32" r="27" fill="url(#sg-coin)" stroke="#8a5a02" strokeWidth="3" />
      <circle cx="32" cy="32" r="20" fill="none" stroke="#8a5a02" strokeWidth="2" opacity="0.55" />
      <path
        d="M32 17c-6 0-10 3.4-10 8 0 8.6 16 5.4 16 12 0 3.2-2.8 5-6 5s-6-1.8-6-5"
        fill="none"
        stroke="#7a4f02"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path d="M32 13v38" stroke="#7a4f02" strokeWidth="4" strokeLinecap="round" />
      <ellipse
        cx="23"
        cy="21"
        rx="6"
        ry="3.6"
        fill="#fff"
        opacity="0.5"
        transform="rotate(-35 23 21)"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Сфера-множитель
// ---------------------------------------------------------------------------

/** Точка восьмиугольника: центр (50,50), радиус r, угол в градусах. */
function oct(r: number): string {
  return [-90, -45, 0, 45, 90, 135, 180, 225]
    .map((deg) => {
      const a = (deg * Math.PI) / 180;
      return `${(50 + r * Math.cos(a)).toFixed(1)},${(50 + r * Math.sin(a)).toFixed(1)}`;
    })
    .join(' ');
}

/** Одна грань: от двух соседних точек внешнего контура к двум точкам стола. */
function facet(i: number, R: number, r: number): string {
  const p = (deg: number, rad: number) => {
    const a = (deg * Math.PI) / 180;
    return `${(50 + rad * Math.cos(a)).toFixed(1)},${(50 + rad * Math.sin(a)).toFixed(1)}`;
  };
  const a0 = -90 + i * 45;
  const a1 = a0 + 45;
  return `${p(a0, R)} ${p(a1, R)} ${p(a1, r)} ${p(a0, r)}`;
}

const GEM_R = 46;
const GEM_TABLE = 22;

/**
 * Огранённый самоцвет для сферы-множителя.
 *
 * Рисуется кодом, а не картинкой: цвета берутся из токенов ступени редкости
 * (`--orb-hi`, `--orb-mid`, `--orb-lo`, `--orb-deep`), поэтому одна фигура
 * обслуживает все шесть ступеней и остаётся резкой на любом размере клетки —
 * растровая иконка на ретине при 68 px поплыла бы.
 *
 * Форма — восьмиугольная огранка «под бриллиант»: стол посередине, на котором
 * читается число, и восемь граней вокруг него, через одну светлее и темнее.
 * Читается как камень именно чередование граней; один блик на круге давал
 * ощущение пластикового шарика.
 */
export function OrbGem() {
  return (
    <svg className="orb__gem" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      {/* Корпус камня */}
      <polygon
        points={oct(GEM_R)}
        fill="var(--orb-lo, #f0a01e)"
        stroke="var(--orb-edge, rgba(120,70,0,.75))"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      {/* Грани: чётные ловят свет, нечётные уходят в тень */}
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <polygon
          key={i}
          points={facet(i, GEM_R, GEM_TABLE)}
          fill={i % 2 === 0 ? 'var(--orb-hi, #fff8d0)' : 'var(--orb-deep, #a35f05)'}
          opacity={i % 2 === 0 ? 0.55 : 0.5}
        />
      ))}
      {/* Стол — на нём лежит число, поэтому он самый светлый и ровный */}
      <polygon
        points={oct(GEM_TABLE)}
        fill="var(--orb-mid, #ffd83d)"
        stroke="var(--orb-hi, #fff8d0)"
        strokeWidth="1.5"
        opacity="0.95"
      />
      {/* Верхний левый блик — единственная «неправильность», она и оживляет */}
      <polygon points={facet(6, GEM_R, GEM_TABLE)} fill="#fff" opacity="0.38" />
    </svg>
  );
}
