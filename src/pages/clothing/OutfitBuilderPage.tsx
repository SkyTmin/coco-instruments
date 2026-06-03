import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Screen } from '@/components/ui';
import { IconCheck } from '@/components/icons';
import { useFinanceStore } from '@/store';
import { CATEGORIES, CATEGORY_EMOJI } from '@/lib/clothing';
import { attachmentHref, fileToAttachment } from '@/lib/images';
import type { ClothingCategory, OutfitLayoutItem, WardrobeItem } from '@/types';
import { notifySuccess, selectionChanged, tapLight } from '@/lib/haptics';

const BASE_FRAC = 0.4; // sticker base width as a fraction of the board
const MIN_SCALE = 0.25;
const MAX_SCALE = 3;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

type Gesture =
  | { kind: 'move'; itemId: string; offX: number; offY: number; sx: number; sy: number; moved: boolean }
  | {
      kind: 'handle';
      itemId: string;
      cxFrac: number;
      cyFrac: number;
      startDist: number;
      startAngle: number;
      startScale: number;
      startRot: number;
    }
  | null;

function loadImageSrc(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function renderCollage(
  stickers: OutfitLayoutItem[],
  byId: Map<string, WardrobeItem>,
): Promise<Blob | null> {
  const W = 900;
  const H = 1200;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#f4efe7';
  ctx.fillRect(0, 0, W, H);

  for (const st of [...stickers].sort((a, b) => a.z - b.z)) {
    const item = byId.get(st.itemId);
    const src = item?.photo ? attachmentHref(item.photo) : '';
    if (!src) continue;
    const img = await loadImageSrc(src);
    if (!img || !img.width) continue;
    const w = BASE_FRAC * W * st.scale;
    const h = w * (img.height / img.width);
    ctx.save();
    ctx.translate(st.x * W, st.y * H);
    ctx.rotate((st.rot * Math.PI) / 180);
    ctx.shadowColor = 'rgba(40,25,15,0.22)';
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 10;
    ctx.fillStyle = '#fff';
    roundRect(ctx, -w / 2, -h / 2, w, h, Math.min(w, h) * 0.08);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    roundRect(ctx, -w / 2, -h / 2, w, h, Math.min(w, h) * 0.08);
    ctx.clip();
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.85));
}

export function OutfitBuilderPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const outfit = useFinanceStore((s) => (id ? s.getOutfit(id) : undefined));
  const wardrobe = useFinanceStore((s) => s.wardrobe);
  const updateOutfit = useFinanceStore((s) => s.updateOutfit);

  const withPhoto = useMemo(() => wardrobe.filter((w) => w.photo), [wardrobe]);
  const byId = useMemo(() => new Map(wardrobe.map((w) => [w.id, w])), [wardrobe]);

  const [stickers, setStickers] = useState<OutfitLayoutItem[]>(() => {
    if (!outfit) return [];
    if (outfit.layout?.length) return outfit.layout.filter((l) => byId.get(l.itemId)?.photo);
    const ids = outfit.itemIds.filter((iid) => byId.get(iid)?.photo);
    return ids.map((itemId, i) => ({
      itemId,
      x: 0.3 + (i % 2) * 0.4,
      y: 0.26 + Math.floor(i / 2) * 0.3,
      scale: 1,
      rot: 0,
      z: i + 1,
    }));
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<ClothingCategory | 'all'>('all');
  const [saving, setSaving] = useState(false);

  const boardRef = useRef<HTMLDivElement | null>(null);
  const gesture = useRef<Gesture>(null);

  // Window-level move/up so dragging works on touch (SVG/HTML alike).
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const g = gesture.current;
      const rect = boardRef.current?.getBoundingClientRect();
      if (!g || !rect) return;
      e.preventDefault();
      if (g.kind === 'move') {
        const x = clamp((e.clientX - rect.left) / rect.width + g.offX, 0, 1);
        const y = clamp((e.clientY - rect.top) / rect.height + g.offY, 0, 1);
        if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > 5) g.moved = true;
        setStickers((s) => s.map((st) => (st.itemId === g.itemId ? { ...st, x, y } : st)));
      } else {
        const cx = rect.left + g.cxFrac * rect.width;
        const cy = rect.top + g.cyFrac * rect.height;
        const dist = Math.hypot(e.clientX - cx, e.clientY - cy);
        const angle = Math.atan2(e.clientY - cy, e.clientX - cx);
        const scale = clamp((g.startScale * dist) / g.startDist, MIN_SCALE, MAX_SCALE);
        const rot = g.startRot + ((angle - g.startAngle) * 180) / Math.PI;
        setStickers((s) => s.map((st) => (st.itemId === g.itemId ? { ...st, scale, rot } : st)));
      }
    };
    const onUp = () => {
      gesture.current = null;
    };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, []);

  if (!outfit || !id) return <Navigate to="/clothing/outfits" replace />;

  const bringToFront = (itemId: string) =>
    setStickers((s) => {
      const maxZ = s.reduce((m, x) => Math.max(m, x.z), 0);
      return s.map((st) => (st.itemId === itemId ? { ...st, z: maxZ + 1 } : st));
    });

  const startMove = (e: ReactPointerEvent, st: OutfitLayoutItem) => {
    e.preventDefault();
    const rect = boardRef.current!.getBoundingClientRect();
    setSelected(st.itemId);
    bringToFront(st.itemId);
    gesture.current = {
      kind: 'move',
      itemId: st.itemId,
      offX: st.x - (e.clientX - rect.left) / rect.width,
      offY: st.y - (e.clientY - rect.top) / rect.height,
      sx: e.clientX,
      sy: e.clientY,
      moved: false,
    };
  };

  const startHandle = (e: ReactPointerEvent, st: OutfitLayoutItem) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = boardRef.current!.getBoundingClientRect();
    const cx = rect.left + st.x * rect.width;
    const cy = rect.top + st.y * rect.height;
    setSelected(st.itemId);
    bringToFront(st.itemId);
    gesture.current = {
      kind: 'handle',
      itemId: st.itemId,
      cxFrac: st.x,
      cyFrac: st.y,
      startDist: Math.hypot(e.clientX - cx, e.clientY - cy) || 1,
      startAngle: Math.atan2(e.clientY - cy, e.clientX - cx),
      startScale: st.scale,
      startRot: st.rot,
    };
  };

  const removeSticker = (itemId: string) => {
    selectionChanged();
    setStickers((s) => s.filter((st) => st.itemId !== itemId));
    setSelected(null);
  };

  const addOrSelect = (itemId: string) => {
    selectionChanged();
    if (stickers.some((s) => s.itemId === itemId)) {
      setSelected(itemId);
      bringToFront(itemId);
      return;
    }
    setStickers((s) => {
      const maxZ = s.reduce((m, x) => Math.max(m, x.z), 0);
      const n = s.length;
      return [
        ...s,
        { itemId, x: 0.5 + ((n % 3) - 1) * 0.12, y: 0.42 + (n % 2) * 0.1, scale: 1, rot: 0, z: maxZ + 1 },
      ];
    });
    setSelected(itemId);
  };

  const save = async () => {
    setSaving(true);
    try {
      let cover = outfit.cover;
      if (stickers.length > 0) {
        const blob = await renderCollage(stickers, byId);
        if (blob) {
          const att = await fileToAttachment(new File([blob], 'outfit.jpg', { type: 'image/jpeg' }));
          cover = att;
        }
      }
      updateOutfit(id, { cover, layout: stickers, itemIds: stickers.map((s) => s.itemId) });
      notifySuccess();
      navigate(`/clothing/outfits/${id}`);
    } finally {
      setSaving(false);
    }
  };

  const trayItems = filter === 'all' ? withPhoto : withPhoto.filter((w) => w.category === filter);

  return (
    <Screen
      title="Коллаж образа"
      subtitle={outfit.name}
      action={
        <button className="icon-btn notes-save" onClick={() => void save()} disabled={saving} aria-label="Сохранить">
          <IconCheck size={21} />
        </button>
      }
    >
      <div
        className="collage-board"
        ref={boardRef}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) setSelected(null);
        }}
      >
        {stickers.length === 0 && (
          <div className="collage-board__hint">Нажимайте на вещи снизу, двигайте, тяните за угол — масштаб и поворот</div>
        )}
        {[...stickers]
          .sort((a, b) => a.z - b.z)
          .map((st) => {
            const item = byId.get(st.itemId);
            if (!item?.photo) return null;
            const isSel = selected === st.itemId;
            return (
              <div
                key={st.itemId}
                className={`sticker${isSel ? ' is-sel' : ''}`}
                style={{
                  left: `${st.x * 100}%`,
                  top: `${st.y * 100}%`,
                  width: `${BASE_FRAC * st.scale * 100}%`,
                  transform: `translate(-50%, -50%) rotate(${st.rot}deg)`,
                  zIndex: st.z,
                }}
                onPointerDown={(e) => startMove(e, st)}
              >
                <img src={attachmentHref(item.photo)} alt="" draggable={false} />
                {isSel && (
                  <>
                    <button
                      className="sticker__del"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => removeSticker(st.itemId)}
                      aria-label="Убрать"
                    >
                      ×
                    </button>
                    <div className="sticker__handle" onPointerDown={(e) => startHandle(e, st)} />
                  </>
                )}
              </div>
            );
          })}
      </div>

      <div className="chips collage-filter">
        <button className={`chip${filter === 'all' ? ' is-active' : ''}`} onClick={() => setFilter('all')}>
          Все
        </button>
        {CATEGORIES.filter((c) => withPhoto.some((w) => w.category === c.id)).map((c) => (
          <button
            key={c.id}
            className={`chip${filter === c.id ? ' is-active' : ''}`}
            onClick={() => setFilter(c.id)}
          >
            {c.emoji} {c.label}
          </button>
        ))}
      </div>

      {withPhoto.length === 0 ? (
        <p className="muted" style={{ textAlign: 'center', padding: '10px' }}>
          Добавьте вещи с фото в гардероб, чтобы собрать коллаж.
        </p>
      ) : (
        <div className="collage-tray">
          {trayItems.map((it) => {
            const on = stickers.some((s) => s.itemId === it.id);
            return (
              <button key={it.id} className={`collage-tray__item${on ? ' is-on' : ''}`} onClick={() => addOrSelect(it.id)}>
                <img src={attachmentHref(it.photo!)} alt="" loading="lazy" />
                {on && <i className="collage-tray__on">✓</i>}
              </button>
            );
          })}
        </div>
      )}

      <button className="btn btn--primary btn--block" style={{ marginTop: 14 }} onClick={() => void save()} disabled={saving}>
        {saving ? 'Сохраняем…' : 'Сохранить коллаж'}
      </button>

      {saving && (
        <div className="bulk-overlay">
          <div className="bulk-overlay__card">
            <div className="bulk-overlay__spin" />
            Рендерим коллаж…
          </div>
        </div>
      )}
    </Screen>
  );
}
