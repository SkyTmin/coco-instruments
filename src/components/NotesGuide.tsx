import { useState } from 'react';
import type { ReactNode } from 'react';
import { Sheet } from '@/components/ui';
import { IconInfo } from '@/components/icons';
import { tapLight } from '@/lib/haptics';

/** "Помощь" button → a short, plain-language guide. Used on the notes list
 *  (a normal screen); inside a note the guide is opened from the ⋯ menu. */
export function NotesHelpButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="icon-btn notes-help-btn"
        aria-label="Как это работает"
        onClick={() => {
          tapLight();
          setOpen(true);
        }}
      >
        <IconInfo size={20} />
      </button>
      {open && <NotesGuide onClose={() => setOpen(false)} />}
    </>
  );
}

function Step({ emoji, title, children }: { emoji: string; title: string; children: ReactNode }) {
  return (
    <div className="guide-step">
      <div className="guide-step__emoji">{emoji}</div>
      <div className="guide-step__body">
        <div className="guide-step__title">{title}</div>
        <div className="guide-step__text">{children}</div>
      </div>
    </div>
  );
}

export function NotesGuide({ onClose }: { onClose: () => void }) {
  return (
    <Sheet onClose={onClose}>
      <div className="guide">
        <div className="guide-head">
          <h3 className="guide-head__title">Как работают заметки</h3>
          <button className="guide-head__close" onClick={onClose} aria-label="Закрыть">
            ×
          </button>
        </div>
        <p className="guide__lead">
          Каждая заметка — это личный чат с собой. Записывайте мысли по одной, как сообщения: текст,
          фото, задачи.
        </p>

        <div className="guide-steps">
          <Step emoji="✍️" title="Пишите мысли">
            Печатайте внизу и жмите <b>➤</b>. Каждая запись — отдельное сообщение. Долгий тап по
            нему — изменить или удалить.
          </Step>
          <Step emoji="＋" title="Кнопка «плюс»">
            Слева от поля ввода. Добавляет фото, файл, тег, связь или задачу — символы помнить не
            нужно.
          </Step>
          <Step emoji="🔗" title="Связи между мыслями">
            Заметки можно объединять по смыслу. Кнопка <b>«Связи»</b> вверху показывает связанные
            заметки и помогает связать новые.
          </Step>
          <Step emoji="#️⃣" title="Теги и темы">
            Помечайте темы: <code>#здоровье</code>. Через слэш — подтема:{' '}
            <code>#здоровье/горло</code>. Теги видно под заголовком; тап открывает страницу темы.
          </Step>
          <Step emoji="🕸" title="Граф связей">
            Все заметки и связи — на одной карте. Откройте через{' '}
            <b>«Связи → Граф вокруг заметки»</b>.
          </Step>
        </div>

        <button className="btn btn--primary btn--block" onClick={onClose}>
          Понятно
        </button>
      </div>
    </Sheet>
  );
}
