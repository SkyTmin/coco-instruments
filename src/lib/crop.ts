// Pure geometry for the image cropper — kept out of the component so it can be
// unit-tested without a DOM. Crop is stored as fractions of the image (0..1),
// so it survives container/orientation resizes.

export type CropRect = { fx: number; fy: number; fw: number; fh: number };
export type DisplayRect = { x: number; y: number; w: number; h: number };
export type CropHandle = 'move' | 'nw' | 'ne' | 'sw' | 'se';

export const FULL_CROP: CropRect = { fx: 0, fy: 0, fw: 1, fh: 1 };
export const MIN_CROP_PX = 44; // smallest crop side on screen

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Apply a drag of (dxF, dyF) image-fractions to the crop `r0`. `move` slides the
 * frame; a corner resizes from that corner with the opposite corner anchored.
 * Everything is clamped to the image and to a minimum on-screen size.
 */
export function resizeCrop(
  mode: CropHandle,
  r0: CropRect,
  dxF: number,
  dyF: number,
  rect: DisplayRect,
): CropRect {
  const minW = Math.min(0.9, MIN_CROP_PX / rect.w);
  const minH = Math.min(0.9, MIN_CROP_PX / rect.h);
  let { fx, fy, fw, fh } = r0;

  if (mode === 'move') {
    fx = clamp(r0.fx + dxF, 0, 1 - r0.fw);
    fy = clamp(r0.fy + dyF, 0, 1 - r0.fh);
    return { fx, fy, fw, fh };
  }
  if (mode === 'se' || mode === 'ne') fw = clamp(r0.fw + dxF, minW, 1 - r0.fx);
  if (mode === 'sw' || mode === 'nw') {
    const nx = clamp(r0.fx + dxF, 0, r0.fx + r0.fw - minW);
    fx = nx;
    fw = r0.fx + r0.fw - nx;
  }
  if (mode === 'se' || mode === 'sw') fh = clamp(r0.fh + dyF, minH, 1 - r0.fy);
  if (mode === 'ne' || mode === 'nw') {
    const ny = clamp(r0.fy + dyF, 0, r0.fy + r0.fh - minH);
    fy = ny;
    fh = r0.fy + r0.fh - ny;
  }
  return { fx, fy, fw, fh };
}

/** Map a crop (fractions) onto integer source pixels for canvas drawImage. */
export function cropToSource(crop: CropRect, naturalW: number, naturalH: number) {
  return {
    sx: Math.round(crop.fx * naturalW),
    sy: Math.round(crop.fy * naturalH),
    sw: Math.max(1, Math.round(crop.fw * naturalW)),
    sh: Math.max(1, Math.round(crop.fh * naturalH)),
  };
}
