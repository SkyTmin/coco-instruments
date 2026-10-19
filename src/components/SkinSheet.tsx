// Выбор скина. Скин общий для обеих игр (лежит в сторе как `slotsSkin`),
// поэтому и лист один на всех — «Слоты» и «Каскад» показывают его одинаково.

import { memo, useCallback, useEffect, useState } from 'react';
import { GxSheet } from '@/components/gx';
import { Bar, Icon } from '@/ui-px';
import { cachedOwner, getBackupStatus } from '@/lib/backup';
import { RELIC_X, SKINS, symbolSrc } from '@/lib/skins';
import type { Skin, SkinId } from '@/lib/skins';
import { SKIN_UNLOCK, isSkinAvailable } from '@/lib/slots-meta';
import { useFinanceStore } from '@/store';
import { levelFromXp } from '@/lib/slots-meta';
import { selectionChanged } from '@/lib/haptics';
import { fmtDec, fmtNum, skinText, useT } from '@/i18n';
import '@/pages/casino.css';

/** Заработанный скин — первым: он тут главный приз, а не строчка списка. */
function order(a: Skin, b: Skin): number {
  return (a.earn ? 0 : 1) - (b.earn ? 0 : 1);
}

/** «×83 из ×200» — сколько ещё до «Реликвии». */
const fmtX = (x: number) => `×${x >= 10 ? fmtNum(x) : fmtDec(x, 1)}`;

export function SkinSheet({ onClose }: { onClose: () => void }) {
  const skin = useFinanceStore((s) => s.slotsSkin);
  const xp = useFinanceStore((s) => s.slotsXp);
  const topX = useFinanceStore((s) => s.slotsTopX);
  const setPrefs = useFinanceStore((s) => s.setSlotsPrefs);
  const level = levelFromXp(xp).level;
  const t = useT();

  // Владелец автомата получает заработанные скины без условия. `null` —
  // «сервер ещё не ответил»: до ответа ничего не решаем, иначе на первом
  // кадре скин выглядел бы запертым, а страховка ниже успела бы сбросить
  // автомат на «Классику».
  const [owner, setOwner] = useState<boolean | null>(cachedOwner());
  useEffect(() => {
    if (owner !== null) return;
    let alive = true;
    void getBackupStatus().then((s) => alive && setOwner(!!s.owner));
    return () => {
      alive = false;
    };
  }, [owner]);
  const granted = owner === true;

  // Stable, so the owner's answer re-renders only the relic's card (`SkinCard` is memo).
  const pick = useCallback(
    (id: SkinId) => {
      selectionChanged();
      setPrefs({ skin: id });
      onClose();
    },
    [setPrefs, onClose],
  );

  // Страховка: если выбранный скин почему-то стал недоступен, возвращаем
  // автомат на «Классику», а не оставляем с символами, которых не выбрать.
  // Ждём ответа сервера: до него мы не знаем, выдан ли заработанный скин.
  useEffect(() => {
    if (owner === null) return;
    const cur = SKINS.find((s) => s.id === skin);
    if (cur && !isSkinAvailable(cur, level, topX, granted)) setPrefs({ skin: 'classic' });
  }, [skin, level, topX, granted, owner, setPrefs]);

  return (
    <GxSheet guard title={t('slots.skin.title')} onClose={onClose} className="cas-skins">
      {/* Лист прокручивает сама сетка: тело листа с набором внутри — `overflow: hidden`
          (gx-px.css), и без своей прокрутки треть скинов и строка лицензии Twemoji были
          недоступны пальцу (critic15 #1). Обе строки внизу — внутри той же прокрутки. */}
      <div className="skn px">
        <div className="skn__grid">
          {/* Все карточки — сразу: второй пакет кадром позже давал отдельную задачу 157–286 мс
            при 4× ровно на первом свайпе (critic12 #5). Картинки за первым экраном грузятся
            и декодируются сами (`loading="lazy"`, `decoding="async"`). */}
          {[...SKINS].sort(order).map((sk, i) => (
            <SkinCard
              key={sk.id}
              sk={sk}
              eager={i < FIRST}
              available={isSkinAvailable(sk, level, topX, granted)}
              active={sk.id === skin}
              // Выдан владельцу, а не добыт спином: подпись должна говорить
              // правду, иначе карточка приписывает игроку чужой рекорд.
              byGrant={!!sk.earn && granted && topX < sk.earn.topX}
              topX={topX}
              onPick={pick}
            />
          ))}
        </div>
        {/* Одна строка про «Реликвию» и строка авторства вместо абзаца на 23 слова (critic9 #13);
            полный текст — в подсказке. */}
        <p className="skn-note" data-tip={t('slots.skin.note')}>
          <Icon name="lock" />
          {t('slots.skin.relicLock', { x: RELIC_X })}
        </p>
        <p className="skn-note skn-note--credit">{t('slots.skin.credit')}</p>
      </div>
    </GxSheet>
  );
}

/** Сколько карточек видно на телефоне сразу — их картинки грузятся первыми. */
const FIRST = 6;

/**
 * Карточка скина (critic K2 #11): витрина — три символа ≥ 40 px, больше половины высоты
 * карточки; имя в одну строку (на узкой карточке длинное — на ступень меньше); под ним строка
 * состояния. Описание скина и условия — в подсказке (`data-tip`: наведение, долгое нажатие).
 */
const SkinCard = memo(function SkinCard({
  sk,
  eager,
  available,
  active,
  byGrant,
  topX,
  onPick,
}: {
  sk: Skin;
  /** On the first screen: its images load at once; the rest are lazy. */
  eager: boolean;
  available: boolean;
  active: boolean;
  byGrant: boolean;
  topX: number;
  onPick: (id: SkinId) => void;
}) {
  const t = useT();
  const name = skinText(sk.id, 'name');
  // Длина имени — классом, а не замером: 13 замеров ширины давали лишние раскладки при открытии.
  const long = name.length > 20 ? ' is-xlong' : name.length > 14 ? ' is-long' : '';
  const quest = !!sk.earn && !available && !byGrant;
  const lockedAt = !available && !sk.earn ? SKIN_UNLOCK[sk.id] : undefined;
  const tip = [
    skinText(sk.id, 'hint'),
    lockedAt !== undefined && t('slots.skin.fromLevel', { n: lockedAt }),
    quest && sk.earn && t('slots.skin.relicWhat', { x: sk.earn.topX }),
    quest && sk.earn && t('slots.skin.yourBest', { x: fmtX(topX), goal: sk.earn.topX }),
    sk.earn &&
      available &&
      (byGrant ? t('slots.skin.grantedNote') : t('slots.skin.earnedBy', { x: fmtX(topX) })),
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <button
      type="button"
      className={`skn-card px-f${active ? ' is-on' : ''}${available ? '' : ' is-locked'}${
        sk.earn ? ' is-earn' : ''
      }`}
      aria-pressed={active}
      aria-disabled={available ? undefined : true}
      aria-label={`${name}. ${tip}`}
      data-tip={tip}
      data-autofocus={active ? '' : undefined}
      onClick={() => available && onPick(sk.id)}
    >
      {/* Витрина скина — в его же палитре. У заработанного она живёт своей жизнью: ореол
          крутится, имя переливается. Всё это — только здесь: если так выглядит каждая
          карточка, ни одна не выглядит редкой. */}
      <span
        className={`skn-card__art skin-card${available ? '' : ' is-locked'}${
          sk.earn ? ' is-relic' : ''
        }`}
        data-skin={sk.id}
        aria-hidden="true"
      >
        {sk.earn && <i className="skin-card__halo" />}
        <span className="skin-card__reels">
          {(['seven', 'star', 'bell'] as const).map((id) => (
            <img
              key={id}
              src={symbolSrc(sk.id, id)}
              alt=""
              loading={eager ? 'eager' : 'lazy'}
              decoding="async"
            />
          ))}
        </span>
      </span>
      <b className={`skn-card__name${long}`}>{name}</b>
      {/* Строка состояния стоит всегда: выбран / заперт / условие. */}
      <span className="skn-card__state">
        {sk.earn && !quest && (
          <span className="skn-badge">
            {byGrant ? t('slots.skin.granted') : t('slots.skin.earned')}
          </span>
        )}
        {quest && sk.earn ? (
          // Прогресс обязателен: условие без «сколько уже» — это не цель, а отказ.
          <span className="skn-quest">
            <Icon name="lock" />
            {/* Narrow no-break spaces: «×83 / ×200» fits the 100-px column of a 320-px phone. */}
            <em className="px-num">{`${fmtX(topX)}\u202f/\u202f×${fmtNum(sk.earn.topX)}`}</em>
            <Bar value={Math.min(1, topX / sk.earn.topX)} />
          </span>
        ) : !available ? (
          // «🔒 Ур. 12»: the short level form fits every card (fr «dès le niveau 12» was cut by
          // 32 px at 320, critic12 #3); the full phrase is in the tooltip / aria-label.
          <span className="skn-lock">
            <Icon name="lock" />
            {t('slots.hud.lvl', { n: SKIN_UNLOCK[sk.id] })}
          </span>
        ) : (
          active && (
            <span className="skn-on">
              <Icon name="check" />
              {t('slots.skin.current')}
            </span>
          )
        )}
      </span>
    </button>
  );
});
