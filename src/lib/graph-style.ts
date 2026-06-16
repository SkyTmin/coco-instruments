// Per-node visual customization for the graph: each node can carry its own
// COLOUR (from a palette) and SHAPE (circle / square / polygon / star …),
// chosen by the user and persisted like highlights.
//
// This is purely cosmetic. The force layout, collisions, hit-testing, zoom and
// navigation all still key off the node's radius `r`; shapes are drawn to fit
// within that same radius, so styling a node never shifts the layout or the
// tuned zoom-to-navigate behaviour.

export type NodeShape =
  | 'circle'
  | 'square'
  | 'rounded'
  | 'diamond'
  | 'triangle'
  | 'pentagon'
  | 'hexagon'
  | 'star';

export interface GraphNodeStyle {
  /** Palette id (see GRAPH_COLORS). Absent → the node keeps its default colour. */
  color?: string;
  /** Absent or 'circle' → the default round node. */
  shape?: NodeShape;
  /** Visual radius multiplier (1 = default). Cosmetic only. */
  size?: number;
  /** An emoji glyph drawn instead of the coloured body, with no background. */
  emoji?: string;
}

/** node id → style. Only customised nodes appear here. */
export type GraphStyleMap = Record<string, GraphNodeStyle>;

export const GRAPH_STYLES_KEY = 'coco-graph-styles';

export interface GraphPalette {
  id: string;
  name: string;
  /** node fill */
  fill: string;
  /** node + label stroke (a deeper shade of the fill) */
  stroke: string;
}

// A generous, explicit palette (fixed hexes so a customised node looks the same
// in light and dark). Warm → cool → neutral, two tidy rows of swatches.
export const GRAPH_COLORS: GraphPalette[] = [
  { id: 'rose', name: 'Роза', fill: '#f3a8b7', stroke: '#e2566f' },
  { id: 'coral', name: 'Коралл', fill: '#f6a98a', stroke: '#ee6a3c' },
  { id: 'amber', name: 'Янтарь', fill: '#f3c879', stroke: '#de9322' },
  { id: 'lemon', name: 'Лимон', fill: '#e9dd80', stroke: '#c2a824' },
  { id: 'lime', name: 'Лайм', fill: '#bcd98a', stroke: '#80aa41' },
  { id: 'green', name: 'Зелёный', fill: '#8ed3a2', stroke: '#34a05e' },
  { id: 'teal', name: 'Бирюза', fill: '#83d3cb', stroke: '#16ab9f' },
  { id: 'sky', name: 'Небо', fill: '#8ec6ef', stroke: '#3597d9' },
  { id: 'blue', name: 'Синий', fill: '#9aaef0', stroke: '#566fe0' },
  { id: 'violet', name: 'Фиолет', fill: '#bca6ef', stroke: '#8b5cf6' },
  { id: 'pink', name: 'Розовый', fill: '#e8a6ef', stroke: '#c952d9' },
  { id: 'slate', name: 'Графит', fill: '#aeb6c2', stroke: '#6a7585' },
];

export const GRAPH_COLOR_BY_ID = new Map(GRAPH_COLORS.map((c) => [c.id, c]));

export interface ShapeOption {
  id: NodeShape;
  name: string;
}

export const GRAPH_SHAPES: ShapeOption[] = [
  { id: 'circle', name: 'Круг' },
  { id: 'square', name: 'Квадрат' },
  { id: 'rounded', name: 'Скруглённый' },
  { id: 'diamond', name: 'Ромб' },
  { id: 'triangle', name: 'Треугольник' },
  { id: 'pentagon', name: 'Пятиугольник' },
  { id: 'hexagon', name: 'Шестиугольник' },
  { id: 'star', name: 'Звезда' },
];

export interface SizeOption {
  id: string;
  name: string;
  /** visual radius multiplier */
  mult: number;
}

export const GRAPH_SIZES: SizeOption[] = [
  { id: 's', name: 'S', mult: 0.78 },
  { id: 'm', name: 'M', mult: 1 },
  { id: 'l', name: 'L', mult: 1.3 },
  { id: 'xl', name: 'XL', mult: 1.65 },
];

// A curated set of fun, useful emoji for tagging nodes (rendered natively with
// no background — nothing to download). Custom image packs come on top of this.
export const GRAPH_EMOJI: string[] = [
  '⭐',
  '🔥',
  '❤️',
  '💡',
  '🚀',
  '🎯',
  '✅',
  '📌',
  '💎',
  '🌟',
  '⚡',
  '🍀',
  '🌈',
  '🎵',
  '📚',
  '💰',
  '🏆',
  '🧠',
  '👑',
  '🔑',
  '🎁',
  '🎨',
  '🛠️',
  '📈',
  '🐱',
  '🐶',
  '🌸',
  '☕',
  '🍕',
  '🎮',
  '🌍',
  '☀️',
  '🌙',
  '😀',
  '😎',
  '🤝',
];

// ---- geometry -------------------------------------------------------------

function ngon(n: number, cx: number, cy: number, r: number, rot = -Math.PI / 2): string {
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i * 2 * Math.PI) / n;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}

function starPoints(cx: number, cy: number, outer: number, inner: number, spikes = 5): string {
  const pts: string[] = [];
  for (let i = 0; i < spikes * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / spikes;
    const rad = i % 2 === 0 ? outer : inner;
    pts.push(`${(cx + rad * Math.cos(a)).toFixed(2)},${(cy + rad * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}

export type ResolvedShape =
  | { el: 'circle' }
  | { el: 'rect'; x: number; y: number; size: number; rx: number }
  | { el: 'polygon'; points: string };

/** Geometry for a shape that fits within radius `r`, centred at (cx, cy). The
 *  radius factors are tuned so each shape reads as roughly the same visual mass
 *  as the default circle. */
export function resolveShape(shape: NodeShape, cx: number, cy: number, r: number): ResolvedShape {
  switch (shape) {
    case 'square':
    case 'rounded': {
      const a = r * 0.82;
      return {
        el: 'rect',
        x: cx - a,
        y: cy - a,
        size: a * 2,
        rx: shape === 'rounded' ? r * 0.34 : 0,
      };
    }
    case 'triangle':
      return { el: 'polygon', points: ngon(3, cx, cy, r * 1.16) };
    case 'diamond':
      return { el: 'polygon', points: ngon(4, cx, cy, r * 1.08) };
    case 'pentagon':
      return { el: 'polygon', points: ngon(5, cx, cy, r * 1.06) };
    case 'hexagon':
      return { el: 'polygon', points: ngon(6, cx, cy, r * 1.04) };
    case 'star':
      return { el: 'polygon', points: starPoints(cx, cy, r * 1.18, r * 0.52) };
    case 'circle':
    default:
      return { el: 'circle' };
  }
}
