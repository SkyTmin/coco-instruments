import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { Attachment } from '@/types';
import { attachmentHref, fileToAttachment, formatBytes, MAX_IMAGE_SOURCE_SIZE } from '@/lib/images';
import { IconImage, IconTrash } from '@/components/icons';
import { notifyWarning, selectionChanged } from '@/lib/haptics';

/** A single-photo picker (camera or gallery on mobile) used by clothing forms. */
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

  const pick = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
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
          void pick(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
