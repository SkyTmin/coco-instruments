// Shared image/file pipeline: pick → (compress images on-device) → upload to
// the VPS (POST /api/notes/attachments, which returns a served /uploads/… URL)
// → fall back to an inline dataUrl when the upload can't be reached. Used by
// Notes and the Wardrobe.
import type { Attachment } from '@/types';
import { genId } from '@/lib/id';
import { getServerAuth } from '@/lib/storage';

export const MAX_ATTACHMENT_SIZE = 3 * 1024 * 1024; // final size after compression
export const MAX_IMAGE_SOURCE_SIZE = 12 * 1024 * 1024; // largest original we accept
export const MAX_ATTACHMENTS = 8;
const IMAGE_MAX_SIDE = 1800;

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${bytes} Б`;
}

/** The best URL to display/download an attachment from. */
export function attachmentHref(attachment: Attachment): string {
  return attachment.url ?? attachment.dataUrl ?? '';
}

export function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('file-read-failed'));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsDataURL(file);
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('canvas-failed'))),
      type,
      quality,
    );
  });
}

export function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image-load-failed'));
    };
    img.src = url;
  });
}

function jpegName(name: string): string {
  return name.replace(/\.[^.]+$/, '') + '.jpg';
}

export async function compressImage(
  file: File,
  maxSide = IMAGE_MAX_SIDE,
): Promise<{ blob: Blob; name: string; type: string }> {
  const img = await loadImage(file);
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas-context-failed');
  ctx.drawImage(img, 0, 0, width, height);

  for (const quality of [0.86, 0.76, 0.66, 0.56]) {
    const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    if (blob.size <= MAX_ATTACHMENT_SIZE) {
      return { blob, name: jpegName(file.name), type: 'image/jpeg' };
    }
  }
  throw new Error('image-too-large');
}

export async function uploadAttachment(input: {
  name: string;
  type: string;
  size: number;
  dataUrl: string;
}): Promise<{ url: string } | null> {
  try {
    const res = await fetch('/api/notes/attachments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ ...input, initData: getServerAuth() }),
    });
    if (!res.ok || !res.headers.get('content-type')?.includes('application/json')) return null;
    const json = (await res.json()) as { url?: string };
    return json.url ? { url: json.url } : null;
  } catch {
    return null;
  }
}

/** Delete the server-side file behind an attachment (fire-and-forget: the
 *  record is already gone from the store; an orphaned file only wastes disk). */
export function deleteAttachmentFile(attachment: Attachment): void {
  if (!attachment.url) return; // inline dataUrl — нечего удалять на сервере
  void fetch('/api/notes/attachments/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ url: attachment.url, initData: getServerAuth() }),
  }).catch(() => {});
}

/** Load an <img> from a URL (same-origin /uploads or a dataUrl). */
export function loadImageSrc(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}

/** Compose up to 4 photos into a 3:4 mosaic cover (auto outfit cover). */
export async function composeMosaic(srcs: string[]): Promise<Blob | null> {
  const W = 900;
  const H = 1200;
  const g = 8;
  const imgs = (
    (await Promise.all(srcs.slice(0, 4).map(loadImageSrc))).filter(Boolean) as HTMLImageElement[]
  ).filter((im) => im.width);
  if (!imgs.length) return null;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#efe7db';
  ctx.fillRect(0, 0, W, H);

  const halfW = (W - g) / 2;
  const halfH = (H - g) / 2;
  let cells: [number, number, number, number][];
  if (imgs.length === 1) cells = [[0, 0, W, H]];
  else if (imgs.length === 2)
    cells = [
      [0, 0, halfW, H],
      [halfW + g, 0, halfW, H],
    ];
  else if (imgs.length === 3)
    cells = [
      [0, 0, halfW, H],
      [halfW + g, 0, halfW, halfH],
      [halfW + g, halfH + g, halfW, halfH],
    ];
  else
    cells = [
      [0, 0, halfW, halfH],
      [halfW + g, 0, halfW, halfH],
      [0, halfH + g, halfW, halfH],
      [halfW + g, halfH + g, halfW, halfH],
    ];
  imgs.forEach((img, i) => drawCover(ctx, img, ...cells[i]));
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.85));
}

/** Pick → compress (images) → upload → returns an Attachment with a `url` or
 *  an inline `dataUrl` fallback. Throws on oversized / unreadable files.
 *  `maxSide` lets callers keep more resolution (camera shots) — the result
 *  still has to fit the server's 3 МБ upload cap. */
export async function fileToAttachment(file: File, maxSide = IMAGE_MAX_SIDE): Promise<Attachment> {
  const isImage = file.type.startsWith('image/');
  if (isImage && file.size > MAX_IMAGE_SOURCE_SIZE) throw new Error('image-source-too-large');
  if (!isImage && file.size > MAX_ATTACHMENT_SIZE) throw new Error('file-too-large');

  const prepared =
    isImage && file.type !== 'image/svg+xml' && file.type !== 'image/gif'
      ? await compressImage(file, maxSide)
      : { blob: file, name: file.name, type: file.type || 'application/octet-stream' };
  if (prepared.blob.size > MAX_ATTACHMENT_SIZE) throw new Error('file-too-large');

  const dataUrl = await readAsDataUrl(prepared.blob);
  const uploaded = await uploadAttachment({
    name: prepared.name,
    type: prepared.type,
    size: prepared.blob.size,
    dataUrl,
  });

  return {
    id: genId(),
    name: prepared.name,
    type: prepared.type,
    size: prepared.blob.size,
    url: uploaded?.url,
    dataUrl: uploaded ? undefined : dataUrl,
    createdAt: Date.now(),
  };
}
