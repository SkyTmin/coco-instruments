import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent, WheelEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ConfirmDialog, Screen, Sheet } from '@/components/ui';
import { IconChevron, IconGraph, IconLock, IconSearch } from '@/components/icons';
import { useFinanceStore } from '@/store';
import type { GraphSize, NoteGraphLink, NoteGraphPoint } from '@/lib/notes-graph';
import {
  GRAPH_VIEW_BOX,
  buildListGraph,
  buildNoteGraph,
  buildOverviewGraph,
  buildPeopleGraph,
  collapseDependencies,
  filterNoteGraph,
  layoutNoteGraph,
  normalizeNoteTitle,
  parseNoteTags,
  personNodeId,
  simulationStep,
} from '@/lib/notes-graph';
import { notifySuccess, selectionChanged, tapMedium } from '@/lib/haptics';
import { getStorage } from '@/lib/storage';
import { NotesHelpButton } from '@/components/NotesGuide';
import { tagColor } from '@/lib/tag-color';
import { hydrateCache, tooltipForTag } from '@/lib/english-deck';
import {
  EMOJI_CODES,
  EMOJI_PACKS,
  GRAPH_COLORS,
  GRAPH_COLOR_BY_ID,
  GRAPH_EMOJI,
  GRAPH_SHAPES,
  GRAPH_SIZES,
  GRAPH_STYLES_KEY,
  cleanStyle,
  emojiImageUrl,
  styleIsEmpty,
  type GraphNodeStyle,
  type GraphStyleMap,
  type NodeShape,
  resolveShape,
} from '@/lib/graph-style';

interface PointerSession {
  id: string;
  pointerId: number;
  x: number;
  y: number;
  moved: boolean;
  startedAt: number;
}

const TAP_MOVE_LIMIT = 10;
const TAP_TIME_LIMIT = 450;
const LONG_PRESS_MS = 450;
const HIGHLIGHTS_KEY = 'coco-graph-highlights';
const MIN_SCALE = 0.2;
const MAX_SCALE = 2.6;

// Coordinate space: a fixed virtual height; the width follows the real stage's
// aspect ratio so the graph fills the whole card (no letterbox, no crop).
const VIRTUAL_H = GRAPH_VIEW_BOX.height;

// Nodes are laid out in a fixed SQUARE box (not the tall full-screen stage), so
// the force layout spreads them radially instead of into a tall rectangle. The
// tall viewport is just a window into this box (positioned by pan/zoom).
const LAYOUT_BOX = { width: VIRTUAL_H, height: VIRTUAL_H };

// Cooling schedule for the live simulation (settles, then sleeps).
const SIM_DECAY = 0.985;
const SIM_MIN_ALPHA = 0.006;
const SIM_DRAG_ALPHA = 0.24;

// Tiny detail nodes (gifts/promises/events) only get labels once you zoom in.
const LABEL_ZOOM = 1.2;

// Zoom-to-navigate: in the overview, keep zooming into the notebook nearest the
// viewport centre and at ENTER it opens that notebook's own graph (a new state);
// a ring "arms" from HINT→ENTER as a pull cue. Inside a notebook, zooming back
// out to EXIT returns to the overview (low, so it takes a deliberate zoom-out).
// Zoom-to-navigate thresholds are relative to the (zoomed-out) home framing, so
// they adapt to however far out the graph is fitted — see zoomThresholds().
const HINT_FACTOR = 2.6;
const ENTER_FACTOR = 3.6;
// Lower → must zoom out more to leave a notebook (deliberate, not accidental).
const EXIT_FACTOR = 0.45;
// The graph opens at this fixed, slightly zoomed-out scale — nodes are NOT
// fitted to a frame, so a busy graph just overflows the edges (pannable).
const HOME_SCALE = 0.5;

function shortLabel(value: string, max = 18): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** Hover tooltip for a node. Tag nodes also show their translation + reading
 *  when the tag is a word from the English deck (the user is learning English). */
function nodeTitle(point: NoteGraphPoint): string {
  if (point.kind === 'tag') {
    const tip = tooltipForTag(point.id.slice(4));
    if (tip) return `${point.label} — ${tip}`;
  }
  return point.label;
}

const clampScale = (s: number) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));

// The SVG body of a node: the default round node (so un-styled nodes look
// exactly as before), or a user-chosen shape drawn to fit radius `r`. Also used
// to draw the little previews in the appearance picker.
function renderShape(shape: NodeShape, cx: number, cy: number, r: number, style?: CSSProperties) {
  if (shape === 'circle') return <circle cx={cx} cy={cy} r={r} style={style} />;
  const g = resolveShape(shape, cx, cy, r);
  if (g.el === 'rect') {
    return (
      <rect
        className="notes-graph__shape"
        x={g.x}
        y={g.y}
        width={g.size}
        height={g.size}
        rx={g.rx}
        ry={g.rx}
        style={style}
      />
    );
  }
  if (g.el === 'polygon') {
    return <polygon className="notes-graph__shape" points={g.points} style={style} />;
  }
  return <circle cx={cx} cy={cy} r={r} style={style} />;
}

// Representative solid colours per node kind — used only for the "before"
// preview in the customization sheet (the live graph uses gradients).
function kindColors(kind: NoteGraphPoint['kind']): { fill: string; stroke: string } {
  switch (kind) {
    case 'person':
      return { fill: '#f1a6ad', stroke: '#e2566f' };
    case 'list':
      return { fill: '#a99bf2', stroke: '#6366f1' };
    case 'tag':
      return { fill: 'var(--tag-fill)', stroke: 'var(--tag-fg)' };
    case 'missing':
      return { fill: 'rgba(215, 154, 43, 0.5)', stroke: 'var(--warn)' };
    default:
      return { fill: '#7fcfd6', stroke: '#2bb0c9' };
  }
}

export function NotesGraphPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const notes = useFinanceStore((s) => s.notes);
  const noteLists = useFinanceStore((s) => s.noteLists);
  const people = useFinanceStore((s) => s.people);
  const gifts = useFinanceStore((s) => s.gifts);
  const promises = useFinanceStore((s) => s.promises);
  const conversations = useFinanceStore((s) => s.conversations);
  const meetIdeas = useFinanceStore((s) => s.meetIdeas);
  const relations = useFinanceStore((s) => s.personRelations);
  const noteLinks = useFinanceStore((s) => s.personNoteLinks);
  const setNoteDepsHidden = useFinanceStore((s) => s.setNoteDepsHidden);
  const personParam = params.get('person');
  const listParam = params.get('list');
  // Open the local graph centred on one note (the Obsidian "local graph").
  const focusParam = params.get('focus');
  // Drill into the full people graph (from the collapsed "Люди" node).
  const peopleParam = params.get('people');
  // A graph scoped to one tag — every note carrying #tag (or #tag/*) + connections.
  const tagParam = params.get('tag');
  const activeList = listParam ? noteLists.find((l) => l.id === listParam) : undefined;
  // The default overview (all notebooks/people). Zooming into a notebook here
  // navigates into that notebook's own graph (a seamless "new state").
  const isOverview = !listParam && !tagParam && !peopleParam && !personParam && !focusParam;
  const graph = useMemo(() => {
    // A single notebook's inner graph, with the notebook itself as an index hub.
    if (listParam) {
      const scoped = notes.filter((n) => n.listId === listParam);
      return activeList ? buildListGraph(activeList, scoped) : buildNoteGraph(scoped);
    }
    // A tag's own graph: the notes tagged with it and how they connect.
    if (tagParam) {
      const key = normalizeNoteTitle(tagParam);
      const prefix = `${key}/`;
      const scoped = notes.filter((n) =>
        parseNoteTags(n.body).some((t) => t === key || t.startsWith(prefix)),
      );
      return buildNoteGraph(scoped);
    }
    // The "Люди" node drills into a people-only graph: people + just the notes
    // linked to them (unrelated notes stay out).
    if (peopleParam) {
      return buildPeopleGraph(notes, {
        people,
        gifts,
        promises,
        conversations,
        meetIdeas,
        relations,
        noteLinks,
      });
    }
    // Person-centric view (opened from the People section) — local mode keeps it
    // to that person's neighbourhood.
    if (personParam) {
      return buildNoteGraph(notes, {
        people,
        gifts,
        promises,
        conversations,
        meetIdeas,
        relations,
        noteLinks,
      });
    }
    // Local graph around one note: every note is its own node (not collapsed
    // into a list), so the focused note and its real neighbourhood exist.
    if (focusParam) {
      return buildNoteGraph(notes, {
        people,
        gifts,
        promises,
        conversations,
        meetIdeas,
        relations,
        noteLinks,
      });
    }
    // Default overview: notebooks + a single "Люди" node; loose notes stay solo.
    return buildOverviewGraph(notes, noteLists, people, noteLinks);
  }, [
    listParam,
    activeList,
    personParam,
    peopleParam,
    focusParam,
    tagParam,
    conversations,
    gifts,
    meetIdeas,
    noteLinks,
    noteLists,
    notes,
    people,
    promises,
    relations,
  ]);
  // Which layer filters are meaningful here: a toggle only appears when the
  // current graph actually holds that kind of node, so no filter ever sits dead
  // (e.g. the overview has no tag/missing nodes, so those chips stay hidden).
  const avail = useMemo(() => {
    const kinds = new Set(graph.nodes.map((n) => n.kind));
    return {
      tags: kinds.has('tag'),
      missing: kinds.has('missing'),
      people: kinds.has('person') || kinds.has('people'),
      details: kinds.has('gift') || kinds.has('promise') || kinds.has('event'),
    };
  }, [graph]);
  const [activeId, setActiveId] = useState<string | undefined>(
    personParam ? personNodeId(personParam) : (focusParam ?? notes[0]?.id),
  );
  const [mode, setMode] = useState<'global' | 'local'>('global');
  const [depth, setDepth] = useState(2);
  const [showMissing, setShowMissing] = useState(true);
  const [showTags, setShowTags] = useState(true);
  const [showPeople, setShowPeople] = useState(true);
  const [showDetails, setShowDetails] = useState(true);
  const [query, setQuery] = useState('');
  const [points, setPoints] = useState<NoteGraphPoint[]>([]);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [menuNode, setMenuNode] = useState<NoteGraphPoint | null>(null);
  // The node whose appearance is being edited (the "Кастомизация" sub-sheet).
  const [styleNode, setStyleNode] = useState<NoteGraphPoint | null>(null);
  const [emojiTab, setEmojiTab] = useState<'system' | 'openmoji' | 'twemoji'>('system');
  // The editor works on a DRAFT; it lands on the graph only on "Применить".
  const [draft, setDraft] = useState<GraphNodeStyle>({});
  // Highlights persist on the server (via the app's storage), so they survive
  // even when the Telegram webview clears localStorage. localStorage seeds the
  // initial state instantly; the durable server copy reconciles on mount.
  const [highlighted, setHighlighted] = useState<Set<string>>(() => {
    try {
      return new Set<string>(JSON.parse(localStorage.getItem(HIGHLIGHTS_KEY) || '[]'));
    } catch {
      return new Set<string>();
    }
  });
  useEffect(() => {
    let alive = true;
    void getStorage()
      .get<string[]>(HIGHLIGHTS_KEY)
      .then((ids) => {
        if (alive && Array.isArray(ids)) setHighlighted(new Set(ids));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  // Warm the English-deck cache so tag tooltips can show translations of words
  // fetched in earlier sessions, not just the curated core.
  useEffect(() => {
    void hydrateCache();
  }, []);
  const persistHighlights = (next: Set<string>) => {
    void getStorage().set(HIGHLIGHTS_KEY, [...next]);
  };
  const toggleHighlight = (nodeId: string) => {
    selectionChanged();
    setHighlighted((cur) => {
      const next = new Set(cur);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      persistHighlights(next);
      return next;
    });
  };
  // Per-node appearance (colour + shape) — same persistence model as highlights:
  // seed instantly from localStorage, then reconcile from the durable server copy.
  const [styles, setStyles] = useState<GraphStyleMap>(() => {
    try {
      return JSON.parse(localStorage.getItem(GRAPH_STYLES_KEY) || '{}') as GraphStyleMap;
    } catch {
      return {};
    }
  });
  useEffect(() => {
    let alive = true;
    void getStorage()
      .get<GraphStyleMap>(GRAPH_STYLES_KEY)
      .then((s) => {
        if (alive && s && typeof s === 'object') setStyles(s);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const persistStyles = (next: GraphStyleMap) => {
    try {
      localStorage.setItem(GRAPH_STYLES_KEY, JSON.stringify(next));
    } catch {
      /* private mode */
    }
    void getStorage().set(GRAPH_STYLES_KEY, next);
  };
  const patchDraft = (patch: Partial<GraphNodeStyle>) => {
    selectionChanged();
    setDraft((d) => cleanStyle({ ...d, ...patch }));
  };
  const applyDraft = () => {
    if (!styleNode) return;
    const id = styleNode.id;
    const cleaned = cleanStyle(draft);
    setStyles((cur) => {
      const next = { ...cur };
      if (styleIsEmpty(cleaned)) delete next[id];
      else next[id] = cleaned;
      persistStyles(next);
      return next;
    });
    notifySuccess();
    setStyleNode(null);
  };
  // Highlighted nodes that actually exist in THIS graph. The clear chip lives
  // where the highlights are — so a highlight made inside a list never surfaces
  // a clear button on the unrelated overview graph.
  const highlightedHere = useMemo(
    () => graph.nodes.filter((n) => highlighted.has(n.id)).map((n) => n.id),
    [graph, highlighted],
  );
  const [confirmClear, setConfirmClear] = useState(false);
  // The floating controls panel collapses to just the search row to free the
  // screen; the filters/mode expand on demand.
  const [controlsOpen, setControlsOpen] = useState(false);
  // The lock (🔒) freezes zoom-to-navigate transitions so you can zoom freely.
  const [locked, setLocked] = useState(() => {
    try {
      return localStorage.getItem('coco-graph-lock') === '1';
    } catch {
      return false;
    }
  });
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const toggleLock = () => {
    selectionChanged();
    setLocked((v) => {
      const next = !v;
      try {
        localStorage.setItem('coco-graph-lock', next ? '1' : '0');
      } catch {
        /* private mode */
      }
      return next;
    });
  };
  const clearHighlights = () => {
    selectionChanged();
    setHighlighted((cur) => {
      const next = new Set(cur);
      for (const id of highlightedHere) next.delete(id);
      persistHighlights(next);
      return next;
    });
  };
  const [size, setSize] = useState<GraphSize>(GRAPH_VIEW_BOX);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const activeIdRef = useRef<string | undefined>(activeId);
  const listParamRef = useRef<string | null>(listParam);
  listParamRef.current = listParam;
  const pointerSession = useRef<PointerSession | null>(null);
  const longPressTimer = useRef(0);
  // Zoom-to-navigate bookkeeping: the focused notebook, a guard so a transition
  // fires once, and whether the "pull" cue tick has been played.
  const focusedRef = useRef<string | null>(null);
  const focusedTargetRef = useRef<string | null>(null);
  const transitionRef = useRef(false);
  const hintArmedRef = useRef(false);
  // The current zoomed-out "home" scale — enter/exit thresholds key off it.
  const homeScaleRef = useRef(0.7);
  // Set once the user pans/zooms/drags, so auto-framing never fights a gesture.
  const userMovedRef = useRef(false);
  // Multi-touch pinch-zoom bookkeeping.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; mx: number; my: number } | null>(null);
  const scaleRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const sizeRef = useRef<GraphSize>(size);
  // Gestures are driven by window-level listeners (SVG pointer capture is
  // unreliable on iOS), so the live gesture state lives in refs.
  const draggingIdRef = useRef<string | null>(null);
  const panningRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const pointByIdRef = useRef(new Map<string, NoteGraphPoint>());
  // Simulation plumbing.
  const linksRef = useRef<NoteGraphLink[]>([]);
  const alphaRef = useRef(0);
  const runningRef = useRef(false);
  const rafRef = useRef(0);
  // Nodes you've dragged are "pinned" — they stay exactly where you put them
  // and don't drift while you arrange the rest.
  const pinnedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);
  useEffect(() => {
    panRef.current = pan;
  }, [pan]);
  useEffect(() => {
    sizeRef.current = size;
  }, [size]);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  // Open the graph at a fixed, slightly zoomed-out scale, centred on its nodes
  // in the area *below* the floating panel. No fit-to-frame: a busy graph simply
  // overflows the edges and you pan to explore it.
  const homeView = useCallback(() => {
    const stage = stageRef.current?.getBoundingClientRect();
    const sz = sizeRef.current;
    const pts = pointsRef.current;
    let reserveVB = 0;
    if (stage && stage.height > 4) {
      const panel = controlsRef.current?.getBoundingClientRect();
      if (panel && panel.height > 0) {
        reserveVB = Math.min(
          sz.height * 0.5,
          Math.max(0, ((panel.bottom - stage.top + 12) / stage.height) * sz.height),
        );
      }
    }
    const s = HOME_SCALE;
    let bcx = sz.width / 2;
    let bcy = sz.height / 2;
    if (pts.length) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const p of pts) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
      bcx = (minX + maxX) / 2;
      bcy = (minY + maxY) / 2;
    }
    const panX = sz.width / 2 - bcx * s;
    const panY = reserveVB + (sz.height - reserveVB) / 2 - bcy * s;
    homeScaleRef.current = s;
    scaleRef.current = s;
    panRef.current = { x: panX, y: panY };
    setScale(s);
    setPan({ x: panX, y: panY });
  }, []);

  // Enter/exit zoom thresholds, derived from the home scale (clamped so they're
  // always reachable within MIN/MAX).
  const zoomThresholds = useCallback(() => {
    const h = homeScaleRef.current || 0.7;
    const hint = Math.min(MAX_SCALE - 0.4, Math.max(h + 0.25, h * HINT_FACTOR));
    const enter = Math.min(MAX_SCALE - 0.1, Math.max(hint + 0.25, h * ENTER_FACTOR));
    const exit = Math.max(MIN_SCALE + 0.03, Math.min(h - 0.06, h * EXIT_FACTOR));
    return { hint, enter, exit };
  }, []);

  // A finished route change clears the one-shot transition guard — and any
  // stale hover/drag focus, which would otherwise dim the whole new graph until
  // you move the mouse (everything reads as "not a neighbour" of the old node).
  useEffect(() => {
    transitionRef.current = false;
    setHoverId(null);
    setDraggingId(null);
    userMovedRef.current = false;
    // Frame immediately, then again once the layout has settled — unless the
    // user has already started panning/zooming (then we leave their view alone).
    const raf = requestAnimationFrame(homeView);
    const settle = window.setTimeout(() => {
      if (!userMovedRef.current) homeView();
    }, 420);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(settle);
    };
  }, [listParam, tagParam, peopleParam, personParam, focusParam, homeView]);

  // Re-frame when the controls panel is collapsed/expanded (the reserved top
  // band changes), unless the user has taken over the view.
  useEffect(() => {
    if (userMovedRef.current) return;
    const raf = requestAnimationFrame(homeView);
    return () => cancelAnimationFrame(raf);
  }, [controlsOpen, homeView]);

  // Zoom-to-navigate: keep zooming into the centred notebook and it opens that
  // notebook's own graph; zoom back out far enough to return — each a seamless
  // state change with a Telegram-style "pull" tick + commit haptic.
  useEffect(() => {
    if (lockedRef.current) {
      hintArmedRef.current = false;
      return; // transitions frozen by the lock — just zoom freely
    }
    const target = focusedTargetRef.current;
    const { enter, exit } = zoomThresholds();
    const inHint = isOverview && scale >= zoomThresholds().hint && !!target;
    if (inHint && !hintArmedRef.current) {
      hintArmedRef.current = true;
      selectionChanged(); // pull cue, like Telegram revealing the next channel
    } else if (!inHint && hintArmedRef.current) {
      hintArmedRef.current = false;
    }
    if (transitionRef.current) return;
    // `replace` so zoom transitions don't pile onto history — the back button
    // returns to where you opened the graph from, not through every zoom.
    if (isOverview && target && scale >= enter) {
      transitionRef.current = true;
      tapMedium();
      notifySuccess();
      homeView();
      navigate(target, { replace: true });
    } else if ((listParam || peopleParam) && scale <= exit) {
      transitionRef.current = true;
      tapMedium();
      notifySuccess();
      homeView();
      navigate('/notes/graph', { replace: true });
    }
  }, [scale, isOverview, listParam, peopleParam, locked, homeView, zoomThresholds, navigate]);

  useEffect(() => {
    if (!personParam) return;
    setMode('local');
    setShowPeople(true);
    setShowDetails(true);
    setActiveId(personNodeId(personParam));
  }, [personParam]);

  // Arriving with ?focus=<noteId> drops you into that note's local neighbourhood.
  useEffect(() => {
    if (!focusParam) return;
    setMode('local');
    setActiveId(focusParam);
  }, [focusParam]);

  // The full people graph opens in global mode with people + details on.
  useEffect(() => {
    if (!peopleParam) return;
    setMode('global');
    setShowPeople(true);
    setShowDetails(true);
  }, [peopleParam]);

  useEffect(() => {
    if (activeId && graph.nodes.some((node) => node.id === activeId)) return;
    setActiveId(
      graph.nodes.find((node) => node.kind === 'note' || node.kind === 'person')?.id ??
        graph.nodes[0]?.id,
    );
  }, [activeId, graph.nodes]);

  const baseVisible = useMemo(
    () =>
      filterNoteGraph(graph, {
        mode,
        activeId,
        depth,
        showMissing,
        showTags,
        showPeople,
        showDetails,
        query,
      }),
    [activeId, depth, graph, mode, query, showDetails, showMissing, showPeople, showTags],
  );
  // Notes whose dependencies are collapsed (hidden) via long-press.
  const collapsedSet = useMemo(
    () => new Set(notes.filter((n) => n.depsHidden).map((n) => n.id)),
    [notes],
  );
  const visibleGraph = useMemo(
    () => collapseDependencies(baseVisible, collapsedSet),
    [baseVisible, collapsedSet],
  );

  // Live mirrors so the layout effect can read the latest graph/positions
  // without taking them as dependencies (selection alone must not re-layout).
  const visibleGraphRef = useRef(visibleGraph);
  visibleGraphRef.current = visibleGraph;
  const pointsRef = useRef<NoteGraphPoint[]>(points);
  pointsRef.current = points;

  // Only the *set* of nodes (or the stage size) forces a rebuild; changing just
  // the selection keeps every position exactly where it is.
  const layoutKey = useMemo(
    () =>
      `${visibleGraph.nodes
        .map((node) => node.id)
        .sort()
        .join('|')}#${visibleGraph.links.length}@${size.width}x${size.height}`,
    [visibleGraph, size],
  );

  useEffect(() => {
    linksRef.current = visibleGraph.links;
  }, [visibleGraph.links]);

  // The cooling animation loop: steps the sim, decays alpha, and sleeps once
  // the layout is relaxed. `kick` (re)heats it on changes / interactions.
  const kick = useCallback((reheat = 0.9) => {
    alphaRef.current = Math.max(alphaRef.current, reheat);
    if (runningRef.current) return;
    runningRef.current = true;
    const tick = () => {
      const dragging = draggingIdRef.current;
      const alpha = alphaRef.current;
      setPoints((current) => {
        if (current.length < 2) return current;
        const next = current.map((p) => ({ ...p }));
        const fixed = new Set(pinnedRef.current);
        if (dragging) fixed.add(dragging);
        simulationStep(next, linksRef.current, LAYOUT_BOX, alpha, fixed, dragging);
        return next;
      });
      let nextAlpha = alpha * SIM_DECAY;
      if (dragging) nextAlpha = Math.max(nextAlpha, SIM_DRAG_ALPHA);
      alphaRef.current = nextAlpha;
      if (nextAlpha > SIM_MIN_ALPHA || dragging) {
        rafRef.current = window.requestAnimationFrame(tick);
      } else {
        runningRef.current = false;
      }
    };
    rafRef.current = window.requestAnimationFrame(tick);
  }, []);

  useEffect(() => () => window.cancelAnimationFrame(rafRef.current), []);

  // Measure the real stage so the coordinate space fills it (width follows the
  // stage aspect; height is fixed at VIRTUAL_H).
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) return;
      const next = { width: Math.round(VIRTUAL_H * (rect.width / rect.height)), height: VIRTUAL_H };
      const prev = sizeRef.current;
      if (Math.abs(prev.width - next.width) < 1) return;
      sizeRef.current = next;
      setSize(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Rebuild only when the node set / size changes, carrying over any positions
  // you've already arranged so dragging one node never resets another.
  useEffect(() => {
    const graphNow = visibleGraphRef.current;
    // Drop pins for nodes that are no longer visible so they re-settle if back.
    const visibleIds = new Set(graphNow.nodes.map((node) => node.id));
    for (const id of pinnedRef.current) if (!visibleIds.has(id)) pinnedRef.current.delete(id);
    const previous = pointsRef.current;
    const seed = previous.length
      ? new Map(previous.map((p) => [p.id, { x: p.x, y: p.y }]))
      : undefined;
    setPoints(layoutNoteGraph(graphNow, activeIdRef.current, LAYOUT_BOX, seed, pinnedRef.current));
    kick(seed ? 0.6 : 1);
  }, [layoutKey, kick]);

  const pointById = useMemo(() => new Map(points.map((point) => [point.id, point])), [points]);
  pointByIdRef.current = pointById;
  const activeNode = graph.nodes.find((node) => node.id === activeId);

  // Interaction focus drives the Obsidian-style highlight/dim of a neighbourhood.
  const focusId = hoverId ?? draggingId;
  const neighborIds = useMemo(() => {
    if (!focusId) return null;
    const set = new Set<string>([focusId]);
    for (const link of visibleGraph.links) {
      if (link.source === focusId) set.add(link.target);
      else if (link.target === focusId) set.add(link.source);
    }
    return set;
  }, [focusId, visibleGraph.links]);

  const labelVisible = (point: NoteGraphPoint): boolean => {
    // While focusing a node, label only its neighbourhood (keeps it readable).
    if (neighborIds) return neighborIds.has(point.id);
    // Otherwise label every meaningful node — notes, people, tags, missing — so
    // you can always tell what's what; tiny detail dots wait until you zoom in.
    if (point.kind === 'gift' || point.kind === 'promise' || point.kind === 'event') {
      return scale >= LABEL_ZOOM;
    }
    return true;
  };

  // Screen pixels → graph coordinates (accounts for pan and zoom; refs so the
  // window-level gesture handlers always read the latest transform).
  const toGraphPoint = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const sx = ((clientX - rect.left) / rect.width) * sizeRef.current.width;
    const sy = ((clientY - rect.top) / rect.height) * sizeRef.current.height;
    return {
      x: (sx - panRef.current.x) / scaleRef.current,
      y: (sy - panRef.current.y) / scaleRef.current,
    };
  };

  // Zoom around a screen point, or the stage centre when none is given.
  const zoomBy = (factor: number, atClientX?: number, atClientY?: number) => {
    userMovedRef.current = true;
    const next = clampScale(scaleRef.current * factor);
    const rect = svgRef.current?.getBoundingClientRect();
    let sx = sizeRef.current.width / 2;
    let sy = sizeRef.current.height / 2;
    if (rect && atClientX !== undefined && atClientY !== undefined) {
      sx = ((atClientX - rect.left) / rect.width) * sizeRef.current.width;
      sy = ((atClientY - rect.top) / rect.height) * sizeRef.current.height;
    }
    const gx = (sx - panRef.current.x) / scaleRef.current;
    const gy = (sy - panRef.current.y) / scaleRef.current;
    const nextPan = { x: sx - next * gx, y: sy - next * gy };
    panRef.current = nextPan;
    scaleRef.current = next;
    setPan(nextPan);
    setScale(next);
  };

  const onWheel = (event: WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    zoomBy(event.deltaY < 0 ? 1.12 : 1 / 1.12, event.clientX, event.clientY);
  };

  // Reset recenters the view and re-runs the auto-layout (releasing any nodes
  // you've pinned), so it doubles as a "tidy up / reshuffle".
  const resetView = () => {
    selectionChanged();
    pinnedRef.current.clear();
    userMovedRef.current = false;
    setPoints(layoutNoteGraph(visibleGraphRef.current, activeIdRef.current, LAYOUT_BOX));
    homeView();
    kick(1);
    window.setTimeout(() => {
      if (!userMovedRef.current) homeView();
    }, 420);
  };

  // ---- gestures (pointerdown starts them; window listeners drive them) ------
  const twoPointers = () => {
    const it = pointers.current.values();
    const a = it.next().value as { x: number; y: number } | undefined;
    const b = it.next().value as { x: number; y: number } | undefined;
    return a && b ? { a, b } : null;
  };
  const maybeStartPinch = () => {
    if (pointers.current.size < 2) return false;
    const tp = twoPointers();
    if (!tp) return false;
    pinch.current = {
      dist: Math.hypot(tp.a.x - tp.b.x, tp.a.y - tp.b.y) || 1,
      mx: (tp.a.x + tp.b.x) / 2,
      my: (tp.a.y + tp.b.y) / 2,
    };
    pointerSession.current = null;
    draggingIdRef.current = null;
    setDraggingId(null);
    panningRef.current = null;
    return true;
  };

  const backgroundPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    event.preventDefault();
    userMovedRef.current = true;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (maybeStartPinch()) return;
    panningRef.current = {
      x: event.clientX,
      y: event.clientY,
      panX: panRef.current.x,
      panY: panRef.current.y,
    };
  };

  const beginNodeDrag = (event: PointerEvent<SVGGElement>, id: string) => {
    event.preventDefault();
    event.stopPropagation();
    userMovedRef.current = true;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (maybeStartPinch()) return;
    const point = pointById.get(id);
    if (!point) return;
    const cursor = toGraphPoint(event.clientX, event.clientY);
    draggingIdRef.current = id;
    setDraggingId(id);
    setActiveId(point.kind === 'missing' || point.kind === 'tag' ? activeIdRef.current : id);
    dragOffset.current = { x: point.x - cursor.x, y: point.y - cursor.y };
    pointerSession.current = {
      id,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
      startedAt: performance.now(),
    };
    // A still hold on any node → buzz when the context menu becomes available
    // (it opens on release, so the press never fights the sheet's backdrop tap).
    window.clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => {
      const s = pointerSession.current;
      if (s && s.id === id && !s.moved) selectionChanged();
    }, LONG_PRESS_MS);
    kick(0.6);
    selectionChanged();
  };

  // Window-level move/up so touch dragging works (SVG pointer capture is
  // dropped by iOS WebKit). Attached once; all state is read from refs.
  useEffect(() => {
    const onMove = (event: globalThis.PointerEvent) => {
      if (pointers.current.has(event.pointerId)) {
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }
      if (pinch.current) {
        const tp = twoPointers();
        const rect = svgRef.current?.getBoundingClientRect();
        if (!tp || !rect) return;
        event.preventDefault();
        const dist = Math.hypot(tp.a.x - tp.b.x, tp.a.y - tp.b.y) || 1;
        const midX = (tp.a.x + tp.b.x) / 2;
        const midY = (tp.a.y + tp.b.y) / 2;
        const sx = ((midX - rect.left) / rect.width) * sizeRef.current.width;
        const sy = ((midY - rect.top) / rect.height) * sizeRef.current.height;
        const newScale = clampScale((scaleRef.current * dist) / pinch.current.dist);
        const midDx = ((midX - pinch.current.mx) / rect.width) * sizeRef.current.width;
        const midDy = ((midY - pinch.current.my) / rect.height) * sizeRef.current.height;
        const gx = (sx - panRef.current.x) / scaleRef.current;
        const gy = (sy - panRef.current.y) / scaleRef.current;
        const nextPan = { x: sx - newScale * gx + midDx, y: sy - newScale * gy + midDy };
        scaleRef.current = newScale;
        panRef.current = nextPan;
        setScale(newScale);
        setPan(nextPan);
        pinch.current = { dist, mx: midX, my: midY };
        return;
      }
      const id = draggingIdRef.current;
      if (id) {
        event.preventDefault();
        const cursor = toGraphPoint(event.clientX, event.clientY);
        const session = pointerSession.current;
        if (session && session.pointerId === event.pointerId) {
          const dx = event.clientX - session.x;
          const dy = event.clientY - session.y;
          if (Math.sqrt(dx * dx + dy * dy) > TAP_MOVE_LIMIT) {
            session.moved = true;
            window.clearTimeout(longPressTimer.current); // a drag isn't a long-press
            pinnedRef.current.add(id); // arranged by hand → keep it there
          }
        }
        setPoints((current) =>
          current.map((point) =>
            point.id === id
              ? {
                  ...point,
                  x: cursor.x + dragOffset.current.x,
                  y: cursor.y + dragOffset.current.y,
                  vx: 0,
                  vy: 0,
                }
              : point,
          ),
        );
        kick(SIM_DRAG_ALPHA);
        return;
      }
      if (panningRef.current) {
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) return;
        event.preventDefault();
        const dx = ((event.clientX - panningRef.current.x) / rect.width) * sizeRef.current.width;
        const dy = ((event.clientY - panningRef.current.y) / rect.height) * sizeRef.current.height;
        const nextPan = { x: panningRef.current.panX + dx, y: panningRef.current.panY + dy };
        panRef.current = nextPan;
        setPan(nextPan);
      }
    };

    const onUp = (event: globalThis.PointerEvent) => {
      pointers.current.delete(event.pointerId);
      window.clearTimeout(longPressTimer.current);
      if (pinch.current && pointers.current.size < 2) pinch.current = null;
      const id = draggingIdRef.current;
      if (id) {
        const s = pointerSession.current;
        if (s && s.id === id && !s.moved) {
          const point = pointByIdRef.current.get(id);
          const held = performance.now() - s.startedAt;
          // A still long-press on any node opens its context menu.
          if (held >= LONG_PRESS_MS && point) {
            setMenuNode(point);
          } else if (held < TAP_TIME_LIMIT) {
            if (point?.kind === 'note') navigate(`/notes/${id}`);
            if (point?.kind === 'person' && point.person) navigate(`/people/${point.person.id}`);
            if (point?.kind === 'list' && point.list) {
              // The hub of the list you're already inside opens that list; a list
              // node in the overview drills into its inner graph.
              navigate(
                listParamRef.current === point.list.id
                  ? `/notes/lists/${point.list.id}`
                  : `/notes/graph?list=${point.list.id}`,
              );
            }
            // The collapsed "Люди" node drills into the full people graph.
            if (point?.kind === 'people') navigate('/notes/graph?people=1');
            // A tag is its own page — open it (content lives on the tag).
            if (point?.kind === 'tag') {
              navigate(`/notes/tag/${encodeURIComponent(point.id.slice(4))}`);
            }
          }
        }
      }
      if (pointers.current.size === 0) {
        pointerSession.current = null;
        if (draggingIdRef.current) {
          draggingIdRef.current = null;
          setDraggingId(null);
          kick(SIM_DRAG_ALPHA);
        }
        panningRef.current = null;
      }
    };

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  const hoverable = (point: NoteGraphPoint) => {
    // Hover highlight is a desktop affordance; touch uses tap/drag instead.
    return {
      onPointerEnter: (event: PointerEvent<SVGGElement>) => {
        if (event.pointerType === 'mouse') setHoverId(point.id);
      },
      onPointerLeave: (event: PointerEvent<SVGGElement>) => {
        if (event.pointerType === 'mouse') setHoverId((cur) => (cur === point.id ? null : cur));
      },
    };
  };

  // The node nearest the viewport centre that a zoom-in will open — a notebook
  // or the "Люди" hub. A ring "arms" around it between the hint and enter zooms.
  let focusedNodeId: string | null = null;
  let focusedTarget: string | null = null;
  let hintT = 0;
  const { hint: hintScale, enter: enterScale } = zoomThresholds();
  if (isOverview && !locked && scale >= hintScale) {
    const vcx = (size.width / 2 - pan.x) / scale;
    const vcy = (size.height / 2 - pan.y) / scale;
    const reach = (size.width / 2 / scale) * 1.15;
    let best = Infinity;
    let bestPoint: NoteGraphPoint | null = null;
    for (const p of points) {
      if (p.kind !== 'list' && p.kind !== 'people') continue;
      const d = Math.hypot(p.x - vcx, p.y - vcy);
      if (d < best && d < reach) {
        best = d;
        bestPoint = p;
      }
    }
    if (bestPoint) {
      focusedNodeId = bestPoint.id;
      focusedTarget =
        bestPoint.kind === 'people'
          ? '/notes/graph?people=1'
          : `/notes/graph?list=${bestPoint.id.slice(5)}`;
    }
    hintT = Math.max(0, Math.min(1, (scale - hintScale) / (enterScale - hintScale)));
  }
  focusedRef.current = focusedNodeId;
  focusedTargetRef.current = focusedTarget;

  return (
    <Screen
      title={
        activeList
          ? `Список: ${activeList.name}`
          : peopleParam
            ? 'Граф: Люди'
            : tagParam
              ? `Граф тега`
              : 'Граф связей'
      }
      subtitle={
        activeList
          ? 'В центре — тетрадь, вокруг её заметки и связи'
          : peopleParam
            ? 'Люди, их заметки, подарки и обещания'
            : tagParam
              ? `#${normalizeNoteTitle(tagParam)} — заметки с этим тегом`
              : activeNode
                ? activeNode.label
                : 'Списки, заметки и люди'
      }
      action={<NotesHelpButton />}
      className="notes-graph-full"
    >
      <div className="notes-graph-fullwrap">
        <div className="card notes-graph-controls graph-controls--float" ref={controlsRef}>
          {(activeList || peopleParam || tagParam) && (
            <button
              className="btn btn--ghost btn--block"
              onClick={() => {
                selectionChanged();
                // Reset the zoom so the overview opens framed (not at the
                // carried-over zoom that would instantly re-arm a notebook).
                panRef.current = { x: 0, y: 0 };
                scaleRef.current = 1;
                setPan({ x: 0, y: 0 });
                setScale(1);
                navigate('/notes/graph');
              }}
            >
              ← Все списки и заметки
            </button>
          )}
          <div className="graph-ctrl-row">
            <div className="notes-search-wrap graph-search-wrap">
              <IconSearch size={17} className="graph-search-ico" />
              <input
                className="input notes-search notes-search--list"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                placeholder="Найти узел на графе"
              />
              {query && (
                <button
                  className="notes-search__clear"
                  onClick={() => setQuery('')}
                  aria-label="Очистить"
                >
                  ×
                </button>
              )}
            </div>
            <button
              className={`graph-ctrl-toggle${controlsOpen ? ' is-open' : ''}`}
              onClick={() => {
                selectionChanged();
                setControlsOpen((o) => !o);
              }}
              aria-label={controlsOpen ? 'Свернуть панель' : 'Фильтры и режим'}
              aria-expanded={controlsOpen}
            >
              <IconChevron size={18} />
            </button>
          </div>
          {controlsOpen && (
            <>
              <div className="segmented">
                <button
                  className={`segmented__opt${mode === 'global' ? ' is-active' : ''}`}
                  aria-pressed={mode === 'global'}
                  onClick={() => {
                    selectionChanged();
                    setMode('global');
                  }}
                >
                  Весь граф
                </button>
                <button
                  className={`segmented__opt${mode === 'local' ? ' is-active' : ''}`}
                  aria-pressed={mode === 'local'}
                  onClick={() => {
                    selectionChanged();
                    setMode('local');
                  }}
                >
                  Вокруг узла
                </button>
              </div>
              {mode === 'local' && (
                <div className="notes-depth">
                  <span className="notes-depth__label">Глубина связей</span>
                  {[1, 2, 3].map((value) => (
                    <button
                      key={value}
                      className={`notes-depth__btn${depth === value ? ' is-active' : ''}`}
                      aria-label={`Глубина связей: ${value}`}
                      aria-pressed={depth === value}
                      onClick={() => {
                        selectionChanged();
                        setDepth(value);
                      }}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              )}
              {(avail.tags ||
                avail.missing ||
                avail.people ||
                (avail.details && showPeople) ||
                highlightedHere.length > 0) && (
                <div className="graph-filters">
                  {avail.tags && (
                    <button
                      className={`graph-chip graph-chip--tags${showTags ? ' is-on' : ''}`}
                      aria-pressed={showTags}
                      onClick={() => {
                        selectionChanged();
                        setShowTags((v) => !v);
                      }}
                    >
                      <span className="graph-chip__dot" />
                      Теги
                    </button>
                  )}
                  {avail.missing && (
                    <button
                      className={`graph-chip graph-chip--missing${showMissing ? ' is-on' : ''}`}
                      aria-pressed={showMissing}
                      onClick={() => {
                        selectionChanged();
                        setShowMissing((v) => !v);
                      }}
                    >
                      <span className="graph-chip__dot" />
                      Не созданы
                    </button>
                  )}
                  {avail.people && (
                    <button
                      className={`graph-chip graph-chip--people${showPeople ? ' is-on' : ''}`}
                      aria-pressed={showPeople}
                      onClick={() => {
                        selectionChanged();
                        setShowPeople((v) => !v);
                      }}
                    >
                      <span className="graph-chip__dot" />
                      Люди
                    </button>
                  )}
                  {avail.details && showPeople && (
                    <button
                      className={`graph-chip graph-chip--details${showDetails ? ' is-on' : ''}`}
                      aria-pressed={showDetails}
                      onClick={() => {
                        selectionChanged();
                        setShowDetails((v) => !v);
                      }}
                    >
                      <span className="graph-chip__dot" />
                      Детали
                    </button>
                  )}
                  {highlightedHere.length > 0 && (
                    <button
                      className="graph-chip graph-chip--clear"
                      onClick={() => setConfirmClear(true)}
                    >
                      <span className="graph-chip__dot" />
                      Снять подсветку · {highlightedHere.length}
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="notes-graph-stage stagger-skip" ref={stageRef}>
          {points.length ? (
            <>
              <svg
                ref={svgRef}
                className={`notes-graph notes-graph--interactive${focusId ? ' is-focusing' : ''}`}
                viewBox={`0 0 ${size.width} ${size.height}`}
                preserveAspectRatio="xMidYMid meet"
                role="img"
                aria-label="Граф заметок"
                onWheel={onWheel}
                onPointerDown={backgroundPointerDown}
              >
                <defs>
                  <linearGradient id="noteNodeGradientInteractive" x1="0" x2="1" y1="0" y2="1">
                    <stop offset="0%" stopColor="#1fc2b8" />
                    <stop offset="100%" stopColor="#36a7e0" />
                  </linearGradient>
                  <linearGradient id="personNodeGradientInteractive" x1="0" x2="1" y1="0" y2="1">
                    <stop offset="0%" stopColor="#ee7f8f" />
                    <stop offset="100%" stopColor="#f2b37e" />
                  </linearGradient>
                  <linearGradient id="listNodeGradientInteractive" x1="0" x2="1" y1="0" y2="1">
                    <stop offset="0%" stopColor="#8b5cf6" />
                    <stop offset="100%" stopColor="#6366f1" />
                  </linearGradient>
                </defs>
                <g transform={`translate(${pan.x} ${pan.y}) scale(${scale})`}>
                  {visibleGraph.links.map((link) => {
                    const source = pointById.get(link.source);
                    const target = pointById.get(link.target);
                    if (!source || !target) return null;
                    const hot = !!focusId && (link.source === focusId || link.target === focusId);
                    const dim = !!focusId && !hot;
                    // Tag links inherit their tag's colour so each topic reads as a family.
                    const tc =
                      link.kind === 'tag' && link.target.startsWith('tag:')
                        ? tagColor(link.target.slice(4))
                        : null;
                    // A node with a chosen "link colour" tints the links touching it
                    // (source wins over target); skipped on the focused/hot link so
                    // the highlight still reads.
                    const linkPalId =
                      styles[link.source]?.linkColor ?? styles[link.target]?.linkColor;
                    const linkPal = linkPalId ? GRAPH_COLOR_BY_ID.get(linkPalId) : null;
                    const linkStyle: CSSProperties | undefined =
                      !hot && linkPal
                        ? { stroke: linkPal.stroke }
                        : tc
                          ? { stroke: tc.stroke }
                          : undefined;
                    return (
                      <line
                        key={link.id}
                        className={`notes-graph__link notes-graph__link--${link.kind}${hot ? ' is-hot' : ''}${dim ? ' is-dim' : ''}`}
                        style={linkStyle}
                        x1={source.x}
                        y1={source.y}
                        x2={target.x}
                        y2={target.y}
                      />
                    );
                  })}
                  {points.map((point, pointIndex) => {
                    const hot = !!neighborIds && neighborIds.has(point.id);
                    const dim = !!neighborIds && !hot;
                    const hl = highlighted.has(point.id);
                    // Per-tag colour: each topic its own hue, sub-tags lighter.
                    const tc = point.kind === 'tag' ? tagColor(point.id.slice(4)) : null;
                    // User customisation: a chosen palette colour and/or shape.
                    const custom = styles[point.id];
                    const palette = custom?.color ? GRAPH_COLOR_BY_ID.get(custom.color) : null;
                    const nodeShape: NodeShape = custom?.shape ?? 'circle';
                    // Visual radius (size multiplier) and an optional emoji glyph
                    // — both purely cosmetic; physics/hit-testing still use point.r.
                    const vr = point.r * (custom?.size ?? 1);
                    const emoji = custom?.emoji;
                    // Colour precedence: highlight (green) → chosen colour → tag
                    // colour → a neutral fill for a shaped-but-uncoloured node →
                    // none (the default CSS gradient for a plain circle).
                    const circleStyle: CSSProperties | undefined = hl
                      ? {
                          fill: 'color-mix(in srgb, var(--pos) 32%, var(--surface))',
                          stroke: 'var(--pos)',
                          strokeWidth: 3.5,
                          filter: 'drop-shadow(0 0 9px var(--pos))',
                        }
                      : palette
                        ? { fill: palette.fill, stroke: palette.stroke }
                        : tc
                          ? { fill: tc.fill, stroke: tc.stroke }
                          : nodeShape !== 'circle'
                            ? { fill: 'var(--surface-2)', stroke: 'var(--accent)' }
                            : undefined;
                    // The node a zoom-in will open gets an "arming" ring that
                    // tightens as you approach the threshold (a pull cue).
                    const armed = isOverview && point.id === focusedNodeId;
                    return (
                      <g
                        key={point.id}
                        className={`notes-graph__node notes-graph__node--${point.kind}${point.id === activeId ? ' is-active' : ''}${point.id === draggingId ? ' is-dragging' : ''}${point.id === focusId ? ' is-focus' : ''}${hot ? ' is-hot' : ''}${dim ? ' is-dim' : ''}${collapsedSet.has(point.id) ? ' is-collapsed' : ''}${hl ? ' is-highlighted' : ''}`}
                        style={{ '--gd': `${Math.min(pointIndex, 12) * 24}ms` } as CSSProperties}
                        onPointerDown={(event) => beginNodeDrag(event, point.id)}
                        onClick={(event) => event.preventDefault()}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          selectionChanged();
                          setMenuNode(point);
                        }}
                        {...hoverable(point)}
                      >
                        <title>{nodeTitle(point)}</title>
                        {armed && hintT > 0.02 && (
                          <circle
                            className="notes-graph__arm"
                            cx={point.x}
                            cy={point.y}
                            r={vr + 6 + (1 - hintT) * 26}
                            opacity={0.25 + hintT * 0.6}
                          />
                        )}
                        {point.id === focusId && (
                          <circle
                            className="notes-graph__halo"
                            cx={point.x}
                            cy={point.y}
                            r={vr + 10}
                          />
                        )}
                        {emoji ? (
                          <>
                            <circle
                              cx={point.x}
                              cy={point.y}
                              r={vr}
                              style={{ fill: 'transparent', stroke: 'none', filter: 'none' }}
                            />
                            {emojiImageUrl(emoji) ? (
                              <image
                                href={emojiImageUrl(emoji)!}
                                x={point.x - vr}
                                y={point.y - vr}
                                width={vr * 2}
                                height={vr * 2}
                              />
                            ) : (
                              <text
                                className="notes-graph__emoji"
                                x={point.x}
                                y={point.y}
                                style={{ fontSize: vr * 1.7 }}
                              >
                                {emoji}
                              </text>
                            )}
                          </>
                        ) : (
                          renderShape(nodeShape, point.x, point.y, vr, circleStyle)
                        )}
                        <text
                          className={`notes-graph__label${labelVisible(point) ? ' is-shown' : ''}`}
                          style={
                            hl
                              ? { fill: 'var(--pos)' }
                              : palette
                                ? { fill: palette.stroke }
                                : tc
                                  ? { fill: tc.stroke }
                                  : undefined
                          }
                          x={point.x}
                          y={point.y + vr + 14}
                        >
                          {shortLabel(point.label)}
                        </text>
                      </g>
                    );
                  })}
                </g>
              </svg>
              <div className="notes-graph-zoom">
                <button
                  onClick={() => {
                    selectionChanged();
                    zoomBy(1.25);
                  }}
                  aria-label="Приблизить"
                >
                  +
                </button>
                <button
                  onClick={() => {
                    selectionChanged();
                    zoomBy(1 / 1.25);
                  }}
                  aria-label="Отдалить"
                >
                  −
                </button>
                <button onClick={resetView} aria-label="Собрать заново">
                  ⊙
                </button>
                <button
                  className={`graph-lock${locked ? ' is-locked' : ''}`}
                  onClick={toggleLock}
                  aria-label={locked ? 'Разблокировать переходы' : 'Заблокировать переходы'}
                  aria-pressed={locked}
                >
                  <IconLock open={!locked} size={17} />
                </button>
              </div>
            </>
          ) : (
            <div className="notes-graph-empty">
              <IconGraph size={34} />
              <div>Нет связей</div>
            </div>
          )}
        </div>
      </div>

      {menuNode &&
        (() => {
          const m = menuNode;
          const isHL = highlighted.has(m.id);
          const open =
            m.kind === 'note'
              ? `/notes/${m.id}`
              : m.kind === 'tag'
                ? `/notes/tag/${encodeURIComponent(m.id.slice(4))}`
                : m.kind === 'list' && m.list
                  ? `/notes/lists/${m.list.id}`
                  : m.kind === 'people'
                    ? '/notes/graph?people=1'
                    : m.kind === 'person' && m.person
                      ? `/people/${m.person.id}`
                      : null;
          const openLabel =
            m.kind === 'note'
              ? 'Открыть заметку'
              : m.kind === 'tag'
                ? 'Открыть тег'
                : m.kind === 'list'
                  ? 'Открыть список'
                  : m.kind === 'people'
                    ? 'Открыть людей'
                    : 'Открыть человека';
          return (
            <Sheet title={m.label} onClose={() => setMenuNode(null)}>
              <div className="stack">
                <button
                  className="btn btn--block graph-customize-btn"
                  onClick={() => {
                    selectionChanged();
                    setDraft(styles[m.id] ?? {});
                    setEmojiTab('system');
                    setMenuNode(null);
                    setStyleNode(m);
                  }}
                >
                  🎨 Кастомизация
                </button>
                <button
                  className={`btn btn--block graph-hl-btn${isHL ? ' is-on' : ''}`}
                  onClick={() => {
                    toggleHighlight(m.id);
                    setMenuNode(null);
                  }}
                >
                  {isHL ? 'Снять подсветку' : 'Подсветить'}
                </button>
                {m.kind === 'note' &&
                  (collapsedSet.has(m.id) ? (
                    <button
                      className="btn btn--ghost btn--block"
                      onClick={() => {
                        setNoteDepsHidden(m.id, false);
                        setMenuNode(null);
                      }}
                    >
                      Показать зависимости
                    </button>
                  ) : (
                    <button
                      className="btn btn--ghost btn--block"
                      onClick={() => {
                        setNoteDepsHidden(m.id, true);
                        setMenuNode(null);
                      }}
                    >
                      Скрыть зависимости
                    </button>
                  ))}
                {m.kind === 'tag' && (
                  <button
                    className="btn btn--ghost btn--block"
                    onClick={() => {
                      setMenuNode(null);
                      navigate(`/notes/graph?tag=${encodeURIComponent(m.id.slice(4))}`);
                    }}
                  >
                    Открыть граф тега
                  </button>
                )}
                {open && (
                  <button
                    className="btn btn--ghost btn--block"
                    onClick={() => {
                      setMenuNode(null);
                      navigate(open);
                    }}
                  >
                    {openLabel}
                  </button>
                )}
              </div>
            </Sheet>
          );
        })()}

      {styleNode &&
        (() => {
          const m = styleNode;
          const cur = draft;
          const curSize = draft.size ?? 1;
          // A single node drawn for the before/after preview swatches.
          const previewBody = (style: GraphNodeStyle | null) => {
            const r = 17 * (style?.size ?? 1);
            const linkPal = style?.linkColor ? GRAPH_COLOR_BY_ID.get(style.linkColor) : null;
            let body;
            if (style?.emoji) {
              const url = emojiImageUrl(style.emoji);
              body = url ? (
                <image href={url} x={32 - r} y={32 - r} width={r * 2} height={r * 2} />
              ) : (
                <text className="notes-graph__emoji" x={32} y={32} style={{ fontSize: r * 1.7 }}>
                  {style.emoji}
                </text>
              );
            } else {
              const pal = style?.color ? GRAPH_COLOR_BY_ID.get(style.color) : null;
              const fallback = kindColors(m.kind);
              const st: CSSProperties = pal
                ? { fill: pal.fill, stroke: pal.stroke }
                : { fill: fallback.fill, stroke: fallback.stroke };
              body = renderShape(style?.shape ?? 'circle', 32, 32, r, st);
            }
            return (
              <>
                {linkPal && (
                  <line
                    x1={5}
                    y1={32}
                    x2={59}
                    y2={32}
                    stroke={linkPal.stroke}
                    strokeWidth={3}
                    strokeLinecap="round"
                  />
                )}
                {body}
              </>
            );
          };
          return (
            <Sheet title={`Кастомизация · ${m.label}`} onClose={() => setStyleNode(null)}>
              <div className="stack cz-body">
                <div className="cz-preview">
                  <div className="cz-preview__cell">
                    <svg viewBox="0 0 64 64" className="cz-preview__svg" aria-hidden="true">
                      {previewBody(styles[m.id] ?? null)}
                    </svg>
                    <span>Было</span>
                  </div>
                  <div className="cz-preview__arrow" aria-hidden="true">
                    →
                  </div>
                  <div className="cz-preview__cell">
                    <svg viewBox="0 0 64 64" className="cz-preview__svg" aria-hidden="true">
                      {previewBody(draft)}
                    </svg>
                    <span>Стало</span>
                  </div>
                </div>

                <span className="graph-style__title">Эмодзи</span>
                <div className="cz-tabs">
                  {EMOJI_PACKS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={`cz-tab${emojiTab === p.id ? ' is-on' : ''}`}
                      onClick={() => setEmojiTab(p.id)}
                      aria-pressed={emojiTab === p.id}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
                <div className="cz-emoji">
                  <button
                    type="button"
                    className={`cz-emoji__btn cz-emoji__none${!cur?.emoji ? ' is-on' : ''}`}
                    onClick={() => patchDraft({ emoji: undefined })}
                    aria-label="Без эмодзи"
                    aria-pressed={!cur?.emoji}
                  >
                    ×
                  </button>
                  {emojiTab === 'system'
                    ? GRAPH_EMOJI.map((e) => (
                        <button
                          key={e}
                          type="button"
                          className={`cz-emoji__btn${cur?.emoji === e ? ' is-on' : ''}`}
                          onClick={() => patchDraft({ emoji: e })}
                          aria-label={`Эмодзи ${e}`}
                          aria-pressed={cur?.emoji === e}
                        >
                          {e}
                        </button>
                      ))
                    : EMOJI_CODES.map((code) => {
                        const dir = emojiTab === 'openmoji' ? 'openmoji' : 'twemoji';
                        const val = `${emojiTab === 'openmoji' ? 'op' : 'tw'}:${code}`;
                        return (
                          <button
                            key={val}
                            type="button"
                            className={`cz-emoji__btn cz-emoji__img${cur?.emoji === val ? ' is-on' : ''}`}
                            onClick={() => patchDraft({ emoji: val })}
                            aria-label="Эмодзи"
                            aria-pressed={cur?.emoji === val}
                          >
                            <img src={`/emoji/${dir}/${code}.svg`} alt="" loading="lazy" />
                          </button>
                        );
                      })}
                </div>
                <p className="cz-hint">С эмодзи узел показывается без фона.</p>

                <span className="graph-style__title">Цвет</span>
                <div className="graph-swatches">
                  <button
                    type="button"
                    className={`graph-swatch graph-swatch--none${!cur?.color ? ' is-on' : ''}`}
                    onClick={() => patchDraft({ color: undefined })}
                    aria-label="Цвет по умолчанию"
                    aria-pressed={!cur?.color}
                  >
                    ×
                  </button>
                  {GRAPH_COLORS.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={`graph-swatch${cur?.color === c.id ? ' is-on' : ''}`}
                      style={{ background: c.fill, borderColor: c.stroke }}
                      onClick={() => patchDraft({ color: c.id })}
                      aria-label={c.name}
                      aria-pressed={cur?.color === c.id}
                    />
                  ))}
                </div>

                <span className="graph-style__title">Цвет связей</span>
                <div className="graph-swatches">
                  <button
                    type="button"
                    className={`graph-swatch graph-swatch--none${!cur?.linkColor ? ' is-on' : ''}`}
                    onClick={() => patchDraft({ linkColor: undefined })}
                    aria-label="Связи по умолчанию"
                    aria-pressed={!cur?.linkColor}
                  >
                    ×
                  </button>
                  {GRAPH_COLORS.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={`graph-swatch${cur?.linkColor === c.id ? ' is-on' : ''}`}
                      style={{ background: c.fill, borderColor: c.stroke }}
                      onClick={() => patchDraft({ linkColor: c.id })}
                      aria-label={c.name}
                      aria-pressed={cur?.linkColor === c.id}
                    />
                  ))}
                </div>

                <span className="graph-style__title">Форма</span>
                <div className="graph-shapes">
                  {GRAPH_SHAPES.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={`graph-shape-opt${(cur?.shape ?? 'circle') === s.id ? ' is-on' : ''}`}
                      onClick={() => patchDraft({ shape: s.id })}
                      aria-label={s.name}
                      aria-pressed={(cur?.shape ?? 'circle') === s.id}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        {renderShape(s.id, 12, 12, 9)}
                      </svg>
                    </button>
                  ))}
                </div>

                <span className="graph-style__title">Размер</span>
                <div className="cz-sizes">
                  {GRAPH_SIZES.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={`cz-size-btn${curSize === s.mult ? ' is-on' : ''}`}
                      onClick={() => patchDraft({ size: s.mult })}
                      aria-label={`Размер ${s.name}`}
                      aria-pressed={curSize === s.mult}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>

                {!styleIsEmpty(draft) && (
                  <button
                    type="button"
                    className="btn btn--ghost btn--block graph-style__reset"
                    onClick={() => {
                      selectionChanged();
                      setDraft({});
                    }}
                  >
                    Сбросить оформление
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn--primary btn--block cz-apply"
                  onClick={applyDraft}
                >
                  ✓ Применить
                </button>
              </div>
            </Sheet>
          );
        })()}

      {confirmClear && (
        <ConfirmDialog
          title="Снять подсветку?"
          message={`Подсветка будет снята со всех выделенных узлов в этом графе (${highlightedHere.length}).`}
          confirmLabel="Снять подсветку"
          onClose={() => setConfirmClear(false)}
          onConfirm={() => {
            clearHighlights();
            setConfirmClear(false);
          }}
        />
      )}
    </Screen>
  );
}
