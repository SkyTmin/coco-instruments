import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent, WheelEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ConfirmDialog, Screen, Sheet } from '@/components/ui';
import { IconGraph, IconSearch } from '@/components/icons';
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
import { selectionChanged } from '@/lib/haptics';
import { getStorage } from '@/lib/storage';
import { NotesHelpButton } from '@/components/NotesGuide';
import { tagColor } from '@/lib/tag-color';
import { englishTagTooltip } from '@/lib/english-words';

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
const MIN_SCALE = 0.5;
const MAX_SCALE = 2.6;

// Coordinate space: a fixed virtual height; the width follows the real stage's
// aspect ratio so the graph fills the whole card (no letterbox, no crop).
const VIRTUAL_H = GRAPH_VIEW_BOX.height;

// Cooling schedule for the live simulation (settles, then sleeps).
const SIM_DECAY = 0.985;
const SIM_MIN_ALPHA = 0.006;
const SIM_DRAG_ALPHA = 0.24;

// Tiny detail nodes (gifts/promises/events) only get labels once you zoom in.
const LABEL_ZOOM = 1.2;

function shortLabel(value: string, max = 18): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** Hover tooltip for a node. Tag nodes also show their translation + reading
 *  when the tag is a word from the English deck (the user is learning English). */
function nodeTitle(point: NoteGraphPoint): string {
  if (point.kind === 'tag') {
    const tip = englishTagTooltip(point.id.slice(4));
    if (tip) return `${point.label} — ${tip}`;
  }
  return point.label;
}

const clampScale = (s: number) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));

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
    // Default overview: notebooks + a single "Люди" node collapse the graph;
    // loose notes and tags stay individual.
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
  // Highlighted nodes that actually exist in THIS graph. The clear chip lives
  // where the highlights are — so a highlight made inside a list never surfaces
  // a clear button on the unrelated overview graph.
  const highlightedHere = useMemo(
    () => graph.nodes.filter((n) => highlighted.has(n.id)).map((n) => n.id),
    [graph, highlighted],
  );
  const [confirmClear, setConfirmClear] = useState(false);
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
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const activeIdRef = useRef<string | undefined>(activeId);
  const listParamRef = useRef<string | null>(listParam);
  listParamRef.current = listParam;
  const pointerSession = useRef<PointerSession | null>(null);
  const longPressTimer = useRef(0);
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
        simulationStep(next, linksRef.current, sizeRef.current, alpha, fixed, dragging);
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
    setPoints(
      layoutNoteGraph(graphNow, activeIdRef.current, sizeRef.current, seed, pinnedRef.current),
    );
    kick(seed ? 0.6 : 1);
  }, [layoutKey, kick]);

  const pointById = useMemo(() => new Map(points.map((point) => [point.id, point])), [points]);
  pointByIdRef.current = pointById;
  const activeNode = graph.nodes.find((node) => node.id === activeId);
  const activeNote = activeNode?.note;
  const activePerson = activeNode?.person;

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
    panRef.current = { x: 0, y: 0 };
    scaleRef.current = 1;
    setPan({ x: 0, y: 0 });
    setScale(1);
    setPoints(layoutNoteGraph(visibleGraphRef.current, activeIdRef.current, sizeRef.current));
    kick(1);
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
    >
      <div className="stack notes-page notes-graph-screen stagger">
        <div className="card notes-graph-controls">
          {(activeList || peopleParam || tagParam) && (
            <button
              className="btn btn--ghost btn--block"
              onClick={() => {
                selectionChanged();
                navigate('/notes/graph');
              }}
            >
              ← Все списки и заметки
            </button>
          )}
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
          <div className="segmented">
            <button
              className={`segmented__opt${mode === 'global' ? ' is-active' : ''}`}
              onClick={() => {
                selectionChanged();
                setMode('global');
              }}
            >
              Весь граф
            </button>
            <button
              className={`segmented__opt${mode === 'local' ? ' is-active' : ''}`}
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
                    return (
                      <line
                        key={link.id}
                        className={`notes-graph__link notes-graph__link--${link.kind}${hot ? ' is-hot' : ''}${dim ? ' is-dim' : ''}`}
                        style={tc ? { stroke: tc.stroke } : undefined}
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
                    // Highlight (green) overrides any per-node colour.
                    const circleStyle = hl
                      ? {
                          fill: 'color-mix(in srgb, var(--pos) 32%, var(--surface))',
                          stroke: 'var(--pos)',
                          strokeWidth: 3.5,
                          filter: 'drop-shadow(0 0 9px var(--pos))',
                        }
                      : tc
                        ? { fill: tc.fill, stroke: tc.stroke }
                        : undefined;
                    return (
                      <g
                        key={point.id}
                        className={`notes-graph__node notes-graph__node--${point.kind}${point.id === activeId ? ' is-active' : ''}${point.id === draggingId ? ' is-dragging' : ''}${point.id === focusId ? ' is-focus' : ''}${hot ? ' is-hot' : ''}${dim ? ' is-dim' : ''}${collapsedSet.has(point.id) ? ' is-collapsed' : ''}${hl ? ' is-highlighted' : ''}`}
                        style={{ '--gd': `${Math.min(pointIndex, 12) * 24}ms` } as CSSProperties}
                        onPointerDown={(event) => beginNodeDrag(event, point.id)}
                        onClick={(event) => event.preventDefault()}
                        {...hoverable(point)}
                      >
                        <title>{nodeTitle(point)}</title>
                        {point.id === focusId && (
                          <circle
                            className="notes-graph__halo"
                            cx={point.x}
                            cy={point.y}
                            r={point.r + 10}
                          />
                        )}
                        <circle cx={point.x} cy={point.y} r={point.r} style={circleStyle} />
                        <text
                          className={`notes-graph__label${labelVisible(point) ? ' is-shown' : ''}`}
                          style={hl ? { fill: 'var(--pos)' } : tc ? { fill: tc.stroke } : undefined}
                          x={point.x}
                          y={point.y + point.r + 14}
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
              </div>
            </>
          ) : (
            <div className="notes-graph-empty">
              <IconGraph size={34} />
              <div>Нет связей</div>
            </div>
          )}
        </div>

        <div className="card notes-graph-hint">
          Перетаскивайте поле или узлы, щипком двумя пальцами (или колесо/кнопки) — масштаб.
          Передвинутые узлы остаются на месте; ⊙ — собрать граф заново. Короткий тап откроет узел,
          долгий тап — меню: подсветить, скрыть зависимости и т.д.
          {activeList
            ? ' Фиолетовый кружок в центре — сама тетрадь; тап по нему открывает список.'
            : ' «Локальный» режим показывает связи вокруг выбранного узла на заданную глубину.'}
          {activeNote && (
            <button
              className="btn btn--ghost btn--block"
              onClick={() => navigate(`/notes/${activeNote.id}`)}
            >
              Открыть «{activeNote.title}»
            </button>
          )}
          {activePerson && (
            <button
              className="btn btn--ghost btn--block"
              onClick={() => navigate(`/people/${activePerson.id}`)}
            >
              Открыть «{activePerson.name}»
            </button>
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
