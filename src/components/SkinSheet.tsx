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

  return (
    <GxSheet title={t('slots.skin.title')} onClose={onClose} className="cas-skins">
      <div className="skn px">
        {[...SKINS].sort(order).map((sk) => {
          const available = isSkinAvailable(sk, level, topX, granted);
          const active = sk.id === skin;
          // Выдан владельцу, а не добыт спином: подпись должна говорить
          // правду, иначе карточка приписывает игроку чужой рекорд.
          const byGrant = !!sk.earn && granted && topX < sk.earn.topX;
          return (
            <button
              key={sk.id}
              type="button"
              className={`skn-card px-f${active ? ' is-on' : ''}${available ? '' : ' is-locked'}`}
              aria-pressed={active}
              aria-disabled={available ? undefined : true}
              data-autofocus={active ? '' : undefined}
              onClick={() => available && pick(sk.id)}
            >
              {/* Витрина скина — в его же палитре (как раньше). У заработанного
                  она живёт своей жизнью: ореол крутится, имя переливается.
                  Всё это — только здесь: если так выглядит каждая карточка,
                  ни одна не выглядит редкой. */}
              <span
                className={`skn-card__art skin-card${available ? '' : ' is-locked'}${
                  sk.earn ? ' is-relic' : ''
                }`}
                data-skin={sk.id}
              >
                {sk.earn && <i className="skin-card__halo" aria-hidden="true" />}
                {sk.earn && (
                  <span className="skin-card__limit is-relic">
                    {byGrant
                      ? t('slots.skin.granted')
                      : available
                        ? t('slots.skin.earned')
                        : t('slots.skin.relic')}
                  </span>
                )}
                <span className="skin-card__reels">
                  <img src={symbolSrc(sk.id, 'seven')} alt="" />
                  <img src={symbolSrc(sk.id, 'star')} alt="" />
                  <img src={symbolSrc(sk.id, 'bell')} alt="" />
                </span>
                <span className="skin-card__name">{skinText(sk.id, 'name')}</span>
              </span>
              <span className="skn-card__hint">{skinText(sk.id, 'hint')}</span>
              {/* Строка состояния стоит всегда: выбран / заперт / условие. */}
              <span className="skn-card__state">
                {sk.earn && !available && !byGrant ? (
                  <span className="skn-quest">
                    <i>{t('slots.skin.relicWhat', { x: sk.earn.topX })}</i>
                    {/* Прогресс обязателен: условие без «сколько уже» — это
                        не цель, а отказ. */}
                    <Bar value={Math.min(1, topX / sk.earn.topX)} />
                    <em className="px-num">
                      {t('slots.skin.yourBest', { x: fmtX(topX), goal: sk.earn.topX })}
                    </em>
                  </span>
                ) : !available ? (
                  <span className="skn-lock">
                    <Icon name="lock" />
                    {t('slots.skin.fromLevel', { n: SKIN_UNLOCK[sk.id] })}
                  </span>
                ) : (
                  <>
                    {active && (
                      <span className="skn-on">
                        <Icon name="check" />
                        {t('slots.skin.current')}
                      </span>
                    )}
                    {sk.earn && (
                      <span className="skn-earned">
                        {byGrant
                          ? t('slots.skin.grantedNote')
                          : t('slots.skin.earnedBy', { x: fmtX(topX) })}
                      </span>
                    )}
                  </>
                )}
              </span>
            </button>
          );
        })}
      </div>
      <p className="skn-note">{t('slots.skin.note')}</p>
    </GxSheet>
  );
}
