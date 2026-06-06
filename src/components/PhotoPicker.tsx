import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { Attachment } from '@/types';
import { attachmentHref, fileToAttachment, formatBytes, MAX_IMAGE_SOURCE_SIZE } from '@/lib/images';
import { useCrop } from '@/components/CropProvider';
import { IconImage, IconTrash } from '@/components/icons';
import { notifyWarning, selectionChanged } from '@/lib/haptics';

/** A single-photo picker (camera or gallery on mobile) used by clothing forms.
 *  Picked photos go through the app-wide crop step before compress + upload. */
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
  const cropImages = useCrop();

  const process = async (file: File) => {
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

  const pickAndCrop = async (file: File) => {
    setError('');
    const [out] = await cropImages([file]); // cropped, skipped, or [] on cancel
    if (out) await process(out);
  };

  // Re-crop the photo already attached (load it back into the cropper).
  const recrop = async () => {
    if (!photo) return;
    try {
      const res = await fetch(attachmentHref(photo));
      const blob = await res.blob();
      await pickAndCrop(new File([blob], photo.name || 'photo.jpg', { type: blob.type || 'image/jpeg' }));
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
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void pickAndCrop(file);
        }}
      />
    </div>
  );
}
