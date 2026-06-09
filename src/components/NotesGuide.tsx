import { useState } from 'react';
import { Sheet } from '@/components/ui';
import { IconInfo } from '@/components/icons';
import { tapLight } from '@/lib/haptics';

/**
 * "i" button → an illustrated cheat-sheet explaining how notes, links, tags,
 * sub-tags and the graph fit together. Drop `<NotesHelpButton />` into any
 * notes-section Screen's `action` prop so the guide is reachable everywhere.
 */
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

export function NotesGuide({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="Как работают заметки" onClose={onClose}>
      <div className="guide">
        <p className="guide__lead">
          Заметки можно связывать друг с другом и помечать тегами — получается ваша личная мини-вики и
          наглядный граф. Вот из чего всё состоит:
        </p>

        {/* 1 — notes, the link between them, and a tag */}
        <section className="guide__card">
          <svg className="guide-dia" viewBox="0 0 320 170" role="img" aria-label="Две заметки связаны ссылкой, у одной есть тег">
            <text className="guide-dia__cap" x="160" y="40">связь [[ ]]</text>
            <line className="guide-dia__link" x1="94" y1="54" x2="226" y2="54" />
            <line className="guide-dia__link guide-dia__link--tag" x1="90" y1="66" x2="170" y2="112" />
            <circle className="guide-dia__note" cx="72" cy="54" r="22" />
            <text className="guide-dia__label" x="72" y="92">Горло</text>
            <circle className="guide-dia__note" cx="248" cy="54" r="22" />
            <text className="guide-dia__label" x="248" y="92">Насморк</text>
            <circle className="guide-dia__tag" cx="180" cy="122" r="15" />
            <text className="guide-dia__label" x="180" y="152">#здоровье</text>
          </svg>
          <h4 className="guide__h">Заметки и связи</h4>
          <p className="guide__p">
            Внутри заметки «Горло» напишите <code>[[Насморк]]</code> — появится <b>связь</b> с заметкой
            «Насморк». В графе это линия между двумя кружками. «Горло» и «Насморк» — просто примеры
            названий ваших заметок.
          </p>
          <p className="guide__p">
            <code>#здоровье</code> — это <b>тег</b>, метка-категория. Заметки с одним тегом легко
            находить и собирать вместе.
          </p>
        </section>

        {/* 2 — hierarchical tags */}
        <section className="guide__card">
          <svg className="guide-dia" viewBox="0 0 320 170" role="img" aria-label="Тег с двумя подтемами">
            <text className="guide-dia__label" x="160" y="20">#здоровье</text>
            <line className="guide-dia__link guide-dia__link--tag" x1="160" y1="58" x2="86" y2="105" />
            <line className="guide-dia__link guide-dia__link--tag" x1="160" y1="58" x2="234" y2="105" />
            <circle className="guide-dia__tag" cx="160" cy="44" r="18" />
            <circle className="guide-dia__tag" cx="80" cy="120" r="15" />
            <text className="guide-dia__label" x="80" y="152">горло</text>
            <circle className="guide-dia__tag" cx="240" cy="120" r="15" />
            <text className="guide-dia__label" x="240" y="152">нос</text>
          </svg>
          <h4 className="guide__h">Вложенные теги (подтемы)</h4>
          <p className="guide__p">
            Тег можно разбить на <b>подтемы</b> через слэш: <code>#здоровье/горло</code> и{' '}
            <code>#здоровье/нос</code>. Тогда «здоровье» становится <b>темой-родителем</b>, а «горло» и
            «нос» — её подтемами. В графе родитель связан со всеми своими подтемами.
          </p>
        </section>

        {/* 3 — colour legend, matching the real graph */}
        <section className="guide__card">
          <h4 className="guide__h">Цвета в графе</h4>
          <div className="guide-legend">
            <span className="guide-legend__item">
              <i className="guide-dot guide-dot--note" />Заметка
            </span>
            <span className="guide-legend__item">
              <i className="guide-dot guide-dot--tag" />Тег
            </span>
            <span className="guide-legend__item">
              <i className="guide-dot guide-dot--list" />Список
            </span>
            <span className="guide-legend__item">
              <i className="guide-dot guide-dot--people" />Люди
            </span>
            <span className="guide-legend__item">
              <i className="guide-dot guide-dot--missing" />Ещё не создана
            </span>
          </div>
        </section>

        {/* 4 — quick syntax cheat-sheet */}
        <section className="guide__card">
          <h4 className="guide__h">Шпаргалка</h4>
          <div className="guide-syntax">
            <div className="guide-syntax__row">
              <code>[[Заметка]]</code>
              <span>связь с другой заметкой</span>
            </div>
            <div className="guide-syntax__row">
              <code>#метка</code>
              <span>тег-категория</span>
            </div>
            <div className="guide-syntax__row">
              <code>#тема/подтема</code>
              <span>вложенный тег</span>
            </div>
            <div className="guide-syntax__row">
              <code>- [ ] дело</code>
              <span>задача с галочкой</span>
            </div>
            <div className="guide-syntax__row">
              <code>**жирный**</code>
              <span>выделение текста</span>
            </div>
            <div className="guide-syntax__row">
              <code>## Заголовок</code>
              <span>подзаголовок</span>
            </div>
          </div>
        </section>

        <button className="btn btn--primary btn--block" onClick={onClose}>
          Понятно
        </button>
      </div>
    </Sheet>
  );
}
