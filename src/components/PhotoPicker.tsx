import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { Attachment } from '@/types';
import { attachmentHref, fileToAttachment, formatBytes, MAX_IMAGE_SOURCE_SIZE } from '@/lib/images';
import { ImageCropper } from '@/components/ImageCropper';
import { IconImage, IconTrash } from '@/components/icons';
import { notifyWarning, selectionChanged } from '@/lib/haptics';

/** A single-photo picker (camera or gallery on mobile) used by clothing forms.
 *  Picked photos go through a crop step before compress + upload. */
export function PhotoPicker({
  photo,
  onChange,
  label = 'Фото',
}: {
  photo?: Attachment;
  onChange: (photo?: Attachment) => void;
  label?: string;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cropFile, setCropFile] = useState<File | null>(null);

  const process = async (file: File) => {
    setError('');
    setBusy(true);
    try {
      const att = await fileToAttachment(file);
      onChange(att);
      selectionChanged();
    } catch {
      setError(`Не удалось — фото больше ${formatBytes(MAX_IMAGE_SOURCE_SIZE)} или не читается`);
      notifyWarning();
    } finally {
      setBusy(false);
    }
  };

  const pick = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setError('');
    // Animated / vector images can't be sensibly cropped to a raster — use as-is.
    if (file.type === 'image/gif' || file.type === 'image/svg+xml') {
      void process(file);
      return;
    }
    setCropFile(file);
  };

  // Re-crop the photo already attached (load it back into the cropper).
  const recrop = async () => {
    if (!photo) return;
    try {
      const res = await fetch(attachmentHref(photo));
      const blob = await res.blob();
      setCropFile(new File([blob], photo.name || 'photo.jpg', { type: blob.type || 'image/jpeg' }));
    } catch {
      notifyWarning();
    }
  };

  return (
    <div className="field">
      <label className="field__label">{label}</label>
      {photo ? (
        <div className="photo-pick">
          <img src={attachmentHref(photo)} alt="" />
          <button
            type="button"
            className="photo-pick__btn photo-pick__change"
            onClick={() => ref.current?.click()}
          >
            Заменить
          </button>
          <button type="button" className="photo-pick__btn photo-pick__crop" onClick={() => void recrop()}>
            Обрезать
          </button>
          <button
            type="button"
            className="photo-pick__btn photo-pick__remove"
            onClick={() => {
              selectionChanged();
              onChange(undefined);
            }}
            aria-label="Убрать фото"
          >
            <IconTrash size={18} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="photo-pick photo-pick--empty"
          onClick={() => ref.current?.click()}
          disabled={busy}
        >
          <IconImage size={28} />
          <span>{busy ? 'Загрузка…' : 'Добавить фото'}</span>
        </button>
      )}
      {error && (
        <div className="notes-error" style={{ marginTop: 8 }}>
          {error}
        </div>
      )}
      <input
        ref={ref}
        hidden
        type="file"
        accept="image/*"
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          pick(e.target.files);
          e.target.value = '';
        }}
      />
      {cropFile && (
        <ImageCropper
          file={cropFile}
          onCancel={() => setCropFile(null)}
          onDone={(f) => {
            setCropFile(null);
            void process(f);
          }}
        />
      )}
    </div>
  );
}
