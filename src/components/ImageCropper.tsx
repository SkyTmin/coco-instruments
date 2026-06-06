import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { selectionChanged, tapMedium } from '@/lib/haptics';
import {
  cropToSource,
  FULL_CROP,
  resizeCrop,
  type CropHandle,
  type CropRect,
  type DisplayRect,
} from '@/lib/crop';

type Rect = DisplayRect;
type Crop = CropRect;
type Mode = CropHandle;

/**
 * Full-screen photo cropper: the image is shown whole, a draggable / resizable
 * frame picks the region to keep. Works with touch and mouse. Returns a cropped
 * JPEG File that the caller feeds into the normal compress → upload pipeline.
 */
export function ImageCropper({
  file,
  onCancel,
  onDone,
}: {
  file: File;
  onCancel: () => void;
  onDone: (cropped: File) => void;
}) {
  const areaRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const drag = useRef<{ mode: Mode; sx: number; sy: number; r0: Crop; pid: number } | null>(null);
  const inited = useRef(false);

  const [url, setUrl] = useState('');
  const [imgRect, setImgRect] = useState<Rect>({ x: 0, y: 0, w: 0, h: 0 });
  const [crop, setCrop] = useState<Crop>({ fx: 0, fy: 0, fw: 1, fh: 1 });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  // Fit the image into the area (contain) and remember the displayed rectangle.
  const measure = () => {
    const area = areaRef.current;
    const img = imgRef.current;
    if (!area || !img || !img.naturalWidth) return;
    const cw = area.clientWidth;
    const ch = area.clientHeight;
    const ar = img.naturalWidth / img.naturalHeight;
    let w = cw;
    let h = cw / ar;
    if (h > ch) {
      h = ch;
      w = ch * ar;
    }
    setImgRect({ x: (cw - w) / 2, y: (ch - h) / 2, w, h });
    if (!inited.current) {
      inited.current = true;
      setCrop(FULL_CROP);
    }
  };

  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(area);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.pid || !imgRect.w) return;
      const dxF = (e.clientX - d.sx) / imgRect.w;
      const dyF = (e.clientY - d.sy) / imgRect.h;
      setCrop(resizeCrop(d.mode, d.r0, dxF, dyF, imgRect));
    };
    const up = (e: PointerEvent) => {
      if (drag.current && e.pointerId === drag.current.pid) drag.current = null;
    };
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [imgRect]);

  const startDrag = (mode: Mode) => (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    drag.current = { mode, sx: e.clientX, sy: e.clientY, r0: crop, pid: e.pointerId };
  };

  const reset = () => {
    setCrop({ fx: 0, fy: 0, fw: 1, fh: 1 });
    selectionChanged();
  };

  const done = async () => {
    const img = imgRef.current;
    if (!img || busy) return;
    setBusy(true);
    try {
      const { sx, sy, sw, sh } = cropToSource(crop, img.naturalWidth, img.naturalHeight);
      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no-ctx');
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
      if (!blob) throw new Error('no-blob');
      const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
      tapMedium();
      onDone(new File([blob], name, { type: 'image/jpeg' }));
    } catch {
      setBusy(false);
    }
  };

  const px =
    imgRect.w > 0
      ? {
          left: imgRect.x + crop.fx * imgRect.w,
          top: imgRect.y + crop.fy * imgRect.h,
          width: crop.fw * imgRect.w,
          height: crop.fh * imgRect.h,
        }
      : null;

  return (
    <div className="cropper" role="dialog" aria-label="Обрезка фото">
      <div className="cropper__head">Обрезать фото</div>
      <div className="cropper__area" ref={areaRef}>
        {url && (
          <img
            ref={imgRef}
            className="cropper__img"
            src={url}
            alt=""
            onLoad={measure}
            style={{ left: imgRect.x, top: imgRect.y, width: imgRect.w, height: imgRect.h }}
            draggable={false}
          />
        )}
        {px && (
          <div className="cropper__crop" style={px} onPointerDown={startDrag('move')}>
            <span className="cropper__grid" aria-hidden />
            <span className="cropper__h cropper__h--nw" onPointerDown={startDrag('nw')} />
            <span className="cropper__h cropper__h--ne" onPointerDown={startDrag('ne')} />
            <span className="cropper__h cropper__h--sw" onPointerDown={startDrag('sw')} />
            <span className="cropper__h cropper__h--se" onPointerDown={startDrag('se')} />
          </div>
        )}
      </div>
      <div className="cropper__foot">
        <button className="btn btn--ghost" type="button" onClick={onCancel} disabled={busy}>
          Отмена
        </button>
        <button className="btn btn--ghost" type="button" onClick={reset} disabled={busy}>
          Сбросить
        </button>
        <button className="btn btn--primary" type="button" onClick={done} disabled={busy}>
          {busy ? 'Готовлю…' : 'Готово'}
        </button>
      </div>
    </div>
  );
}
