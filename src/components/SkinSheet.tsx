// Выбор скина. Скин общий для обеих игр (лежит в сторе как `slotsSkin`),
// поэтому и лист один на всех — «Слоты» и «Каскад» показывают его одинаково.

import { useEffect, useState } from 'react';
import { GxSheet } from '@/components/gx';
import { Bar, Icon } from '@/ui-px';
import { cachedOwner, getBackupStatus } from '@/lib/backup';
import { SKINS, symbolSrc } from '@/lib/skins';
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

  const pick = (id: SkinId) => {
    selectionChanged();
    setPrefs({ skin: id });
    onClose();
  };

  // Страховка: если выбранный скин почему-то стал недоступен, возвращаем
  // автомат на «Классику», а не оставляем с символами, которых не выбрать.
  // Ждём ответа сервера: до него мы не знаем, выдан ли заработанный скин.
  useEffect(() => {
    if (owner === null) return;
    const cur = SKINS.find((s) => s.id === skin);
    if (cur && !isSkinAvailable(cur, level, topX, granted)) setPrefs({ skin: 'classic' });
  }, [skin, level, topX, granted, owner, setPrefs]);

  // Первые карточки — сразу, остальные (и их картинки) — кадром позже: лист открывался одной
  // длинной задачей (294 мс), и его 160-мс появление терялось (critic K2 #11). Коробки
  // карточек стоят с первого кадра, так что ничего не прыгает.
  const [warm, setWarm] = useState(false);
  useEffect(() => {
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => setWarm(true));
    });
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <GxSheet title={t('slots.skin.title')} onClose={onClose} className="cas-skins">
      <div className="skn px">
        {[...SKINS].sort(order).map((sk, i) =>
          // За краем первого экрана на первом кадре — пустые рамки той же сетки: лист должен
          // показаться за ≤ 100 мс при 4× (critic9 #8), карточки дорисуются кадром позже.
          !warm && i >= FIRST ? (
            <span key={sk.id} className="skn-card skn-card--ph" aria-hidden="true" />
          ) : (
            <SkinCard
              key={sk.id}
              sk={sk}
              art={warm || i < FIRST}
              available={isSkinAvailable(sk, level, topX, granted)}
              active={sk.id === skin}
              // Выдан владельцу, а не добыт спином: подпись должна говорить
              // правду, иначе карточка приписывает игроку чужой рекорд.
              byGrant={!!sk.earn && granted && topX < sk.earn.topX}
              topX={topX}
              onPick={pick}
            />
          ),
        )}
      </div>
      <p className="skn-note">{t('slots.skin.note')}</p>
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
function SkinCard({
  sk,
  art,
  available,
  active,
  byGrant,
  topX,
  onPick,
}: {
  sk: Skin;
  art: boolean;
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
  const tip = [
    skinText(sk.id, 'hint'),
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
      className={`skn-card px-f${active ? ' is-on' : ''}${available ? '' : ' is-locked'}`}
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
        {sk.earn && art && <i className="skin-card__halo" />}
        <span className="skin-card__reels">
          {art &&
            (['seven', 'star', 'bell'] as const).map((id) => (
              <img key={id} src={symbolSrc(sk.id, id)} alt="" loading="lazy" decoding="async" />
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
            <em className="px-num">
              {fmtX(topX)} / ×{fmtNum(sk.earn.topX)}
            </em>
            <Bar value={Math.min(1, topX / sk.earn.topX)} />
          </span>
        ) : !available ? (
          <span className="skn-lock">
            <Icon name="lock" />
            {t('slots.skin.fromLevel', { n: SKIN_UNLOCK[sk.id] })}
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
}
