import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent, WheelEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen } from '@/components/ui';
import { IconGraph } from '@/components/icons';
import { useFinanceStore } from '@/store';
import type { NoteGraphPoint } from '@/lib/notes-graph';
import {
  GRAPH_VIEW_BOX,
  buildNoteGraph,
  filterNoteGraph,
  layoutNoteGraph,
} from '@/lib/notes-graph';
import { selectionChanged } from '@/lib/haptics';

interface Velocity {
  x: number;
  y: number;
}

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
const MIN_SCALE = 0.5;
const MAX_SCALE = 2.6;

function shortLabel(value: string, max = 17): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

const clampScale = (s: number) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));

export function NotesGraphPage() {
  const navigate = useNavigate();
  const notes = useFinanceStore((s) => s.notes);
  const graph = useMemo(() => buildNoteGraph(notes), [notes]);
  const [activeId, setActiveId] = useState<string | undefined>(notes[0]?.id);
  const [mode, setMode] = useState<'global' | 'local'>('global');
  const [depth, setDepth] = useState(2);
  const [showMissing, setShowMissing] = useState(true);
  const [showTags, setShowTags] = useState(true);
  const [query, setQuery] = useState('');
  const [points, setPoints] = useState<NoteGraphPoint[]>([]);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [panning, setPanning] = useState<null | { x: number; y: number; panX: number; panY: number }>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const velocities = useRef(new Map<string, Velocity>());
  const dragOffset = useRef({ x: 0, y: 0 });
  const activeIdRef = useRef<string | undefined>(activeId);
  const pointerSession = useRef<PointerSession | null>(null);
  // Multi-touch pinch-zoom bookkeeping.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; mx: number; my: number } | null>(null);
  const scaleRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);
  useEffect(() => {
    panRef.current = pan;
  }, [pan]);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    if (activeId && notes.some((note) => note.id === activeId)) return;
    setActiveId(notes[0]?.id);
  }, [activeId, notes]);

  const visibleGraph = useMemo(
    () =>
      filterNoteGraph(graph, {
        mode,
        activeId,
        depth,
        showMissing,
        showTags,
        query,
      }),
    [activeId, depth, graph, mode, query, showMissing, showTags],
  );

  useEffect(() => {
    setPoints(layoutNoteGraph(visibleGraph, activeId));
    velocities.current = new Map();
  }, [activeId, visibleGraph]);

  const pointById = useMemo(() => new Map(points.map((point) => [point.id, point])), [points]);
  const activeNote = notes.find((note) => note.id === activeId);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      setPoints((current) => {
        if (current.length < 2) return current;
        const next = current.map((point) => ({ ...point }));
        const byId = new Map(next.map((point) => [point.id, point]));

        for (const point of next) {
          if (!velocities.current.has(point.id)) velocities.current.set(point.id, { x: 0, y: 0 });
        }

        for (let i = 0; i < next.length; i++) {
          for (let j = i + 1; j < next.length; j++) {
            const a = next[i];
            const b = next[j];
            const dx = a.x - b.x || 0.1;
            const dy = a.y - b.y || 0.1;
            const distSq = Math.max(80, dx * dx + dy * dy);
            const force = 880 / distSq;
            const dist = Math.sqrt(distSq);
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            const av = velocities.current.get(a.id)!;
            const bv = velocities.current.get(b.id)!;
            av.x += fx;
            av.y += fy;
            bv.x -= fx;
            bv.y -= fy;
          }
        }

        for (const link of visibleGraph.links) {
          const source = byId.get(link.source);
          const target = byId.get(link.target);
          if (!source || !target) continue;
          const dx = target.x - source.x;
          const dy = target.y - source.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const preferred = link.kind === 'tag' ? 84 : 116;
          const stiffness = link.kind === 'tag' ? 0.008 : 0.018;
          const force = (dist - preferred) * stiffness;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          const sv = velocities.current.get(source.id)!;
          const tv = velocities.current.get(target.id)!;
          sv.x += fx;
          sv.y += fy;
          tv.x -= fx;
          tv.y -= fy;
        }

        for (const point of next) {
          const velocity = velocities.current.get(point.id)!;
          if (point.id === draggingId) {
            velocity.x = 0;
            velocity.y = 0;
            continue;
          }
          velocity.x += (GRAPH_VIEW_BOX.width / 2 - point.x) * 0.0018;
          velocity.y += (GRAPH_VIEW_BOX.height / 2 - point.y) * 0.0018;
          velocity.x *= 0.86;
          velocity.y *= 0.86;
          point.x = Math.max(32, Math.min(GRAPH_VIEW_BOX.width - 32, point.x + velocity.x));
          point.y = Math.max(34, Math.min(GRAPH_VIEW_BOX.height - 34, point.y + velocity.y));
        }
        return next;
      });
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [draggingId, visibleGraph.links]);

  // Screen pixels → graph coordinates (accounts for pan and zoom).
  const toGraphPoint = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const sx = ((clientX - rect.left) / rect.width) * GRAPH_VIEW_BOX.width;
    const sy = ((clientY - rect.top) / rect.height) * GRAPH_VIEW_BOX.height;
    return { x: (sx - pan.x) / scale, y: (sy - pan.y) / scale };
  };

  // Zoom around a screen point, or the stage centre when none is given.
  const zoomBy = (factor: number, atClientX?: number, atClientY?: number) => {
    const next = clampScale(scale * factor);
    const rect = svgRef.current?.getBoundingClientRect();
    let sx = GRAPH_VIEW_BOX.width / 2;
    let sy = GRAPH_VIEW_BOX.height / 2;
    if (rect && atClientX !== undefined && atClientY !== undefined) {
      sx = ((atClientX - rect.left) / rect.width) * GRAPH_VIEW_BOX.width;
      sy = ((atClientY - rect.top) / rect.height) * GRAPH_VIEW_BOX.height;
    }
    const gx = (sx - pan.x) / scale;
    const gy = (sy - pan.y) / scale;
    setPan({ x: sx - next * gx, y: sy - next * gy });
    setScale(next);
  };

  const onWheel = (event: WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    zoomBy(event.deltaY < 0 ? 1.12 : 1 / 1.12, event.clientX, event.clientY);
  };

  const resetView = () => {
    selectionChanged();
    setPan({ x: 0, y: 0 });
    setScale(1);
  };

  // ---- pinch-zoom -----------------------------------------------------------
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
    setDraggingId(null);
    setPanning(null);
    return true;
  };

  const backgroundPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    event.preventDefault();
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    svgRef.current?.setPointerCapture(event.pointerId);
    if (maybeStartPinch()) return;
    setPanning({ x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y });
  };

  const beginNodeDrag = (event: PointerEvent<SVGGElement>, id: string) => {
    event.preventDefault();
    event.stopPropagation();
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (maybeStartPinch()) return;
    const point = pointById.get(id);
    if (!point) return;
    const cursor = toGraphPoint(event.clientX, event.clientY);
    setDraggingId(id);
    setActiveId(id.startsWith('missing:') || id.startsWith('tag:') ? activeIdRef.current : id);
    dragOffset.current = { x: point.x - cursor.x, y: point.y - cursor.y };
    pointerSession.current = {
      id,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
      startedAt: performance.now(),
    };
    (event.currentTarget as SVGGElement).setPointerCapture(event.pointerId);
    selectionChanged();
  };

  const movePointer = (event: PointerEvent<SVGSVGElement>) => {
    event.preventDefault();
    if (pointers.current.has(event.pointerId)) {
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (pinch.current) {
      const tp = twoPointers();
      const rect = svgRef.current?.getBoundingClientRect();
      if (!tp || !rect) return;
      const dist = Math.hypot(tp.a.x - tp.b.x, tp.a.y - tp.b.y) || 1;
      const midX = (tp.a.x + tp.b.x) / 2;
      const midY = (tp.a.y + tp.b.y) / 2;
      const sx = ((midX - rect.left) / rect.width) * GRAPH_VIEW_BOX.width;
      const sy = ((midY - rect.top) / rect.height) * GRAPH_VIEW_BOX.height;
      const newScale = clampScale((scaleRef.current * dist) / pinch.current.dist);
      const midDx = ((midX - pinch.current.mx) / rect.width) * GRAPH_VIEW_BOX.width;
      const midDy = ((midY - pinch.current.my) / rect.height) * GRAPH_VIEW_BOX.height;
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
    if (draggingId) {
      const cursor = toGraphPoint(event.clientX, event.clientY);
      const session = pointerSession.current;
      if (session && session.pointerId === event.pointerId) {
        const dx = event.clientX - session.x;
        const dy = event.clientY - session.y;
        if (Math.sqrt(dx * dx + dy * dy) > TAP_MOVE_LIMIT) session.moved = true;
      }
      setPoints((current) =>
        current.map((point) =>
          point.id === draggingId
            ? { ...point, x: cursor.x + dragOffset.current.x, y: cursor.y + dragOffset.current.y }
            : point,
        ),
      );
      return;
    }
    if (panning) {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const dx = ((event.clientX - panning.x) / rect.width) * GRAPH_VIEW_BOX.width;
      const dy = ((event.clientY - panning.y) / rect.height) * GRAPH_VIEW_BOX.height;
      setPan({ x: panning.panX + dx, y: panning.panY + dy });
    }
  };

  const endPointer = (event: PointerEvent<SVGSVGElement>, openOnTap: boolean) => {
    pointers.current.delete(event.pointerId);
    if (pinch.current && pointers.current.size < 2) pinch.current = null;
    const session = pointerSession.current;
    if (openOnTap && draggingId && session?.id === draggingId && !session.moved) {
      const elapsed = performance.now() - session.startedAt;
      const point = pointById.get(draggingId);
      if (elapsed < TAP_TIME_LIMIT && point?.kind === 'note') {
        navigate(`/notes/${point.id}`);
      }
    }
    pointerSession.current = null;
    setDraggingId(null);
    setPanning(null);
  };

  return (
    <Screen title="Граф заметок" subtitle={activeNote ? activeNote.title : 'Вся база'}>
      <div className="stack notes-page notes-graph-screen">
        <div className="card notes-graph-controls">
          <div className="segmented">
            <button
              className={`segmented__opt${mode === 'global' ? ' is-active' : ''}`}
              onClick={() => setMode('global')}
            >
              Глобальный
            </button>
            <button
              className={`segmented__opt${mode === 'local' ? ' is-active' : ''}`}
              onClick={() => setMode('local')}
            >
              Локальный
            </button>
          </div>
          <div className="notes-toolbar">
            <input
              className="input notes-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Фильтр"
            />
            <button className={`notes-toggle${showTags ? ' is-active' : ''}`} onClick={() => setShowTags((v) => !v)}>
              Теги
            </button>
            <button
              className={`notes-toggle${showMissing ? ' is-active' : ''}`}
              onClick={() => setShowMissing((v) => !v)}
            >
              Пустые
            </button>
          </div>
          {mode === 'local' && (
            <div className="notes-depth">
              {[1, 2, 3].map((value) => (
                <button
                  key={value}
                  className={`notes-depth__btn${depth === value ? ' is-active' : ''}`}
                  onClick={() => setDepth(value)}
                >
                  {value}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="notes-graph-stage">
          {points.length ? (
            <>
              <svg
                ref={svgRef}
                className="notes-graph notes-graph--interactive"
                viewBox={`0 0 ${GRAPH_VIEW_BOX.width} ${GRAPH_VIEW_BOX.height}`}
                role="img"
                aria-label="Граф заметок"
                onWheel={onWheel}
                onPointerDown={backgroundPointerDown}
                onPointerMove={movePointer}
                onPointerUp={(e) => endPointer(e, true)}
                onPointerCancel={(e) => endPointer(e, false)}
                onPointerLeave={(e) => endPointer(e, false)}
              >
                <defs>
                  <linearGradient id="noteNodeGradientInteractive" x1="0" x2="1" y1="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent-grad-1)" />
                    <stop offset="100%" stopColor="var(--accent-grad-2)" />
                  </linearGradient>
                </defs>
                <g transform={`translate(${pan.x} ${pan.y}) scale(${scale})`}>
                  {visibleGraph.links.map((link) => {
                    const source = pointById.get(link.source);
                    const target = pointById.get(link.target);
                    if (!source || !target) return null;
                    return (
                      <line
                        key={link.id}
                        className={`notes-graph__link notes-graph__link--${link.kind}`}
                        x1={source.x}
                        y1={source.y}
                        x2={target.x}
                        y2={target.y}
                      />
                    );
                  })}
                  {points.map((point) => (
                    <g
                      key={point.id}
                      className={`notes-graph__node notes-graph__node--${point.kind}${point.id === activeId ? ' is-active' : ''}${point.id === draggingId ? ' is-dragging' : ''}`}
                      onPointerDown={(event) => beginNodeDrag(event, point.id)}
                      onClick={(event) => event.preventDefault()}
                    >
                      <title>{point.label}</title>
                      <circle cx={point.x} cy={point.y} r={point.r} />
                      <text x={point.x} y={point.y + point.r + 15}>
                        {shortLabel(point.label)}
                      </text>
                    </g>
                  ))}
                </g>
              </svg>
              <div className="notes-graph-zoom">
                <button onClick={() => { selectionChanged(); zoomBy(1.25); }} aria-label="Приблизить">
                  +
                </button>
                <button onClick={() => { selectionChanged(); zoomBy(1 / 1.25); }} aria-label="Отдалить">
                  −
                </button>
                <button onClick={resetView} aria-label="Сбросить вид">
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
          Короткий тап откроет заметку.
          {activeNote && (
            <button className="btn btn--ghost btn--block" onClick={() => navigate(`/notes/${activeNote.id}`)}>
              Открыть «{activeNote.title}»
            </button>
          )}
        </div>
      </div>
    </Screen>
  );
}
