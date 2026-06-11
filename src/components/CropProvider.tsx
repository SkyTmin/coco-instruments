import { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { PropsWithChildren } from 'react';
import { ImageCropper } from '@/components/ImageCropper';

/** App-wide photo cropping: any photo added anywhere goes through the cropper.
 *  `cropImages(files)` opens the cropper for each raster image in turn and
 *  resolves with the files to keep (cropped / skipped, in the original order),
 *  or an empty array if the user cancels the batch. */
type CropImages = (files: File[]) => Promise<File[]>;

const CropContext = createContext<CropImages>(async (files) => files);

export const useCrop = () => useContext(CropContext);

const isCroppable = (f: File) =>
  f.type.startsWith('image/') && f.type !== 'image/gif' && f.type !== 'image/svg+xml';

export function CropProvider({ children }: PropsWithChildren) {
  const [active, setActive] = useState<{ file: File; index: number; total: number } | null>(null);
  const job = useRef<{
    files: File[];
    targets: number[];
    pos: number;
    resolve: (r: File[]) => void;
  } | null>(null);

  const advance = useCallback((pos: number) => {
    const j = job.current;
    if (!j) return;
    if (pos >= j.targets.length) {
      const { resolve, files } = j;
      job.current = null;
      setActive(null);
      resolve(files);
      return;
    }
    j.pos = pos;
    setActive({ file: j.files[j.targets[pos]], index: pos, total: j.targets.length });
  }, []);

  const cropImages = useCallback<CropImages>(
    (files) =>
      new Promise<File[]>((resolve) => {
        const targets = files.map((f, i) => (isCroppable(f) ? i : -1)).filter((i) => i >= 0);
        if (!targets.length) {
          resolve(files);
          return;
        }
        job.current = { files: [...files], targets, pos: 0, resolve };
        advance(0);
      }),
    [advance],
  );

  const onDone = (cropped: File) => {
    const j = job.current;
    if (!j) return;
    j.files[j.targets[j.pos]] = cropped;
    advance(j.pos + 1);
  };
  const onSkip = () => {
    const j = job.current;
    if (j) advance(j.pos + 1);
  };
  const onCancel = () => {
    const j = job.current;
    if (!j) return;
    const { resolve } = j;
    job.current = null;
    setActive(null);
    resolve([]);
  };

  return (
    <CropContext.Provider value={cropImages}>
      {children}
      {active && (
        <ImageCropper
          key={active.index}
          file={active.file}
          index={active.index}
          total={active.total}
          onDone={onDone}
          onSkip={onSkip}
          onCancel={onCancel}
        />
      )}
    </CropContext.Provider>
  );
}
