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
  /** An emoji glyph drawn instead of the coloured body, with no background.
   *  Native unicode char (e.g. "🔥") or a pack ref ("op:1f525" / "tw:1f525"). */
  emoji?: string;
  /** Palette id used to tint the links touching this node. */
  linkColor?: string;
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

// A big set of native unicode emoji for tagging nodes (rendered with no
// background — nothing to download). The image packs below add other art styles.
export const GRAPH_EMOJI: string[] = [
  '😀',
  '😃',
  '😄',
  '😁',
  '😆',
  '😅',
  '😂',
  '🤣',
  '🥲',
  '😊',
  '🙂',
  '🙃',
  '😉',
  '😌',
  '😍',
  '🥰',
  '😘',
  '😋',
  '😜',
  '🤪',
  '😝',
  '🤗',
  '🤔',
  '😐',
  '😶',
  '😏',
  '😒',
  '🙄',
  '😴',
  '😷',
  '🤒',
  '🤢',
  '🥵',
  '😵',
  '🤯',
  '🤠',
  '🥳',
  '😎',
  '🤓',
  '🧐',
  '🙁',
  '😢',
  '😭',
  '😡',
  '🤬',
  '😈',
  '💀',
  '💩',
  '🤡',
  '👻',
  '👽',
  '🤖',
  '🎃',
  '❤️',
  '🧡',
  '💛',
  '💚',
  '💙',
  '💜',
  '🖤',
  '🤍',
  '💔',
  '💕',
  '💖',
  '💘',
  '⭐',
  '🌟',
  '✨',
  '⚡',
  '🔥',
  '💥',
  '💯',
  '✅',
  '❌',
  '❗',
  '👋',
  '👌',
  '✌️',
  '🤞',
  '🤙',
  '👍',
  '👎',
  '👊',
  '👏',
  '🙌',
  '🙏',
  '💪',
  '🐶',
  '🐱',
  '🐭',
  '🐹',
  '🐰',
  '🦊',
  '🐻',
  '🐼',
  '🐨',
  '🐯',
  '🦁',
  '🐮',
  '🐷',
  '🐸',
  '🐵',
  '🐔',
  '🐧',
  '🦄',
  '🐝',
  '🐢',
  '🐙',
  '🐳',
  '🦋',
  '🌵',
  '🌲',
  '🌳',
  '🌴',
  '🍀',
  '🌿',
  '🍁',
  '🌸',
  '🌹',
  '🌻',
  '🌷',
  '🍎',
  '🍊',
  '🍋',
  '🍌',
  '🍉',
  '🍇',
  '🍓',
  '🍒',
  '🍑',
  '🍅',
  '🥕',
  '🍔',
  '🍟',
  '🍕',
  '🍩',
  '🍪',
  '🎂',
  '☕',
  '🍺',
  '⚽',
  '🏀',
  '🎾',
  '🎮',
  '🎯',
  '🎲',
  '🎸',
  '🎤',
  '🎧',
  '🎬',
  '📷',
  '📚',
  '📖',
  '✏️',
  '📌',
  '🔒',
  '🔑',
  '💡',
  '🎁',
  '🎈',
  '🎉',
  '🏆',
  '🥇',
  '💰',
  '💎',
  '⏰',
  '🚀',
  '✈️',
  '🚗',
  '🚲',
  '🏠',
  '🌍',
  '🌈',
  '☀️',
  '🌙',
  '🌊',
];

// Downloaded image emoji packs (bundled under public/emoji/<pack>/<code>.svg).
// On a node these are stored as "op:<code>" (OpenMoji) or "tw:<code>" (Twemoji).
export interface EmojiPack {
  id: 'system' | 'openmoji' | 'twemoji';
  name: string;
  /** value prefix for this pack ('' = a native unicode char from GRAPH_EMOJI) */
  prefix: '' | 'op' | 'tw';
}

export const EMOJI_PACKS: EmojiPack[] = [
  { id: 'system', name: 'Обычные', prefix: '' },
  { id: 'openmoji', name: 'OpenMoji', prefix: 'op' },
  { id: 'twemoji', name: 'Twemoji', prefix: 'tw' },
];

// Codepoints bundled for BOTH image packs (lowercase hex), in a curated order.
export const EMOJI_CODES: string[] = [
  '1f600',
  '1f603',
  '1f604',
  '1f60a',
  '1f602',
  '1f923',
  '1f60d',
  '1f618',
  '1f60b',
  '1f61c',
  '1f92a',
  '1f970',
  '1f917',
  '1f60e',
  '1f644',
  '1f60f',
  '1f614',
  '1f62d',
  '1f621',
  '1f47b',
  '1f4a9',
  '1f608',
  '2764',
  '1f9e1',
  '1f49a',
  '1f499',
  '1f49c',
  '1f494',
  '2b50',
  '1f31f',
  '2728',
  '26a1',
  '1f525',
  '1f4af',
  '1f44b',
  '1f44d',
  '1f44e',
  '1f44f',
  '1f64c',
  '1f64f',
  '1f4aa',
  '1f91d',
  '270c',
  '1f44c',
  '1f436',
  '1f431',
  '1f42d',
  '1f430',
  '1f43c',
  '1f42f',
  '1f981',
  '1f437',
  '1f438',
  '1f98b',
  '1f34e',
  '1f349',
  '1f353',
  '1f355',
  '1f354',
  '1f370',
  '2615',
  '1f37a',
  '1f3a8',
  '1f3ae',
  '1f3af',
  '1f3b5',
  '1f3b8',
  '1f3a4',
  '1f4f7',
  '1f4da',
  '1f4cc',
  '1f511',
  '1f381',
  '1f388',
  '1f389',
  '1f3c6',
  '1f4b0',
  '1f48e',
  '1f4c8',
  '1f9e0',
  '1f680',
  '2708',
  '1f697',
  '1f3e0',
  '1f308',
  '2600',
  '1f319',
  '1f30d',
  '1f334',
  '1f340',
  '1f338',
  '1f33b',
  '2705',
  '1f451',
  '2753',
  '2757',
];

/** A node's emoji value → bundled image URL, or null when it's native unicode. */
export function emojiImageUrl(value: string): string | null {
  const m = /^(op|tw):([0-9a-f-]+)$/.exec(value);
  if (!m) return null;
  return `/emoji/${m[1] === 'op' ? 'openmoji' : 'twemoji'}/${m[2]}.svg`;
}

/** Drop default/empty fields so an unchanged node stores nothing. */
export function cleanStyle(s: GraphNodeStyle): GraphNodeStyle {
  const c: GraphNodeStyle = {};
  if (s.color) c.color = s.color;
  if (s.shape && s.shape !== 'circle') c.shape = s.shape;
  if (s.size && s.size !== 1) c.size = s.size;
  if (s.emoji) c.emoji = s.emoji;
  if (s.linkColor) c.linkColor = s.linkColor;
  return c;
}

export function styleIsEmpty(s: GraphNodeStyle): boolean {
  return !(s.color || s.shape || s.size || s.emoji || s.linkColor);
}

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
