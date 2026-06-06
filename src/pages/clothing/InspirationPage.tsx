import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { EmptyState, Fab, Screen } from '@/components/ui';
import { IconTrash } from '@/components/icons';
import { Photo } from '@/components/Photo';
import { useFinanceStore } from '@/store';
import { attachmentHref, fileToAttachment } from '@/lib/images';
import { useCrop } from '@/components/CropProvider';
import { pluralizeRu } from '@/lib/format';
import { notifySuccess, notifyWarning, tapLight } from '@/lib/haptics';

export function InspirationPage() {
  const inspiration = useFinanceStore((s) => s.inspiration);
  const addInspiration = useFinanceStore((s) => s.addInspiration);
  const removeInspiration = useFinanceStore((s) => s.removeInspiration);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [view, setView] = useState<string | null>(null);

  const cropImages = useCrop();

  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    const arr = await cropImages(Array.from(files).slice(0, 40));
    if (!arr.length) return;
    setBusy({ done: 0, total: arr.length });
    const atts = [];
    let n = 0;
    for (const file of arr) {
      try {
        atts.push(await fileToAttachment(file));
      } catch {
        /* skip */
      }
      n += 1;
      setBusy({ done: n, total: arr.length });
    }
    if (atts.length) addInspiration(atts);
    setBusy(null);
    notifySuccess();
  };

  const current = inspiration.find((x) => x.id === view);

  return (
    <Screen
      title="Вдохновение"
      subtitle={
        inspiration.length
          ? `${inspiration.length} ${pluralizeRu(inspiration.length, ['идея', 'идеи', 'идей'])}`
          : 'Идеи и референсы'
      }
    >
      <input
        ref={inputRef}
        hidden
        type="file"
        accept="image/*"
        multiple
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          void add(e.target.files);
          e.target.value = '';
        }}
      />

      {inspiration.length === 0 ? (
        <>
          <EmptyState
            icon="✨"
            title="Доска вдохновения пуста"
            sub="Сохраняйте скриншоты, фото и идеи образов — чтобы вернуться к ним позже"
          />
          <button className="btn btn--primary btn--block" onClick={() => inputRef.current?.click()}>
            Добавить изображения
          </button>
        </>
      ) : (
        <div className="inspo-masonry">
          {inspiration.map((img, i) => (
            <button
              key={img.id}
              className="inspo-item"
              style={{ animationDelay: `${Math.min(i, 16) * 22}ms` }}
              onClick={() => {
                tapLight();
                setView(img.id);
              }}
            >
              <Photo src={attachmentHref(img.photo)} natural />
            </button>
          ))}
        </div>
      )}

      <Fab
        onClick={() => {
          tapLight();
          inputRef.current?.click();
        }}
      />

      {current && (
        <div className="lightbox" onClick={() => setView(null)}>
          <img src={attachmentHref(current.photo)} alt="" onClick={(e) => e.stopPropagation()} />
          <button
            className="lightbox__del"
            onClick={(e) => {
              e.stopPropagation();
              removeInspiration(current.id);
              notifyWarning();
              setView(null);
            }}
            aria-label="Удалить"
          >
            <IconTrash size={20} />
          </button>
          <button className="lightbox__close" onClick={() => setView(null)} aria-label="Закрыть">
            ×
          </button>
        </div>
      )}

      {busy && (
        <div className="bulk-overlay">
          <div className="bulk-overlay__card">
            <div className="bulk-overlay__spin" />
            Загрузка… {busy.done}/{busy.total}
          </div>
        </div>
      )}
    </Screen>
  );
}
