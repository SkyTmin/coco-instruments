import { useState } from 'react';
import { EmptyState, Screen } from '@/components/ui';
import { IconTrash } from '@/components/icons';
import { Photo } from '@/components/Photo';
import { useFinanceStore } from '@/store';
import { attachmentHref } from '@/lib/images';
import { pluralizeRu } from '@/lib/format';
import { notifyWarning, tapLight } from '@/lib/haptics';

const dateFmt = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** Галерея камеры: снимки, сохранённые в приложении. Отсюда фото можно
 *  сохранить на телефон / отправить в чат (share sheet) или удалить. */
export function CameraGalleryPage() {
  const shots = useFinanceStore((s) => s.cameraShots);
  const removeShot = useFinanceStore((s) => s.removeCameraShot);
  const [view, setView] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  const current = shots.find((s) => s.id === view);

  // Файл может лежать на сервере (/uploads) — тянем blob и отдаём в системный
  // share sheet: оттуда «Сохранить изображение» в галерею телефона или чат.
  const share = async () => {
    if (!current) return;
    tapLight();
    setMsg('');
    try {
      const res = await fetch(attachmentHref(current.photo));
      const blob = await res.blob();
      const file = new File([blob], current.photo.name || 'coco-photo.jpg', {
        type: blob.type || 'image/jpeg',
      });
      if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'Coco Камера' });
          return;
        } catch (err) {
          if ((err as DOMException)?.name === 'AbortError') return;
        }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch {
      setMsg('Не удалось получить файл — попробуйте ещё раз.');
      notifyWarning();
    }
  };

  return (
    <Screen
      title="Галерея камеры"
      subtitle={
        shots.length
          ? `${shots.length} ${pluralizeRu(shots.length, ['снимок', 'снимка', 'снимков'])}`
          : 'Снимки из раздела «Камера»'
      }
    >
      {shots.length === 0 ? (
        <EmptyState
          icon="📷"
          title="Снимков пока нет"
          sub="Всё, что вы фотографируете в «Камере», сохраняется сюда автоматически"
        />
      ) : (
        <div className="inspo-masonry">
          {shots.map((s, i) => (
            <button
              key={s.id}
              className="inspo-item"
              style={{ animationDelay: `${Math.min(i, 16) * 22}ms` }}
              onClick={() => {
                tapLight();
                setMsg('');
                setView(s.id);
              }}
            >
              <Photo src={attachmentHref(s.photo)} natural />
            </button>
          ))}
        </div>
      )}

      {current && (
        <div className="lightbox" onClick={() => setView(null)}>
          <img src={attachmentHref(current.photo)} alt="" onClick={(e) => e.stopPropagation()} />
          <div className="lightbox__bar" onClick={(e) => e.stopPropagation()}>
            <span className="lightbox__meta">{dateFmt.format(new Date(current.createdAt))}</span>
            <button className="btn btn--primary" onClick={() => void share()}>
              Сохранить / отправить
            </button>
          </div>
          {msg && (
            <p className="lightbox__msg" onClick={(e) => e.stopPropagation()}>
              {msg}
            </p>
          )}
          <button
            className="lightbox__del"
            onClick={(e) => {
              e.stopPropagation();
              removeShot(current.id);
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
    </Screen>
  );
}
