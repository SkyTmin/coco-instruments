// Выбор скина. Скин общий для обеих игр (лежит в сторе как `slotsSkin`),
// поэтому и лист один на всех — «Слоты» и «Каскад» показывают его одинаково.

import { useEffect, useState } from 'react';
import { Sheet } from '@/components/ui';
import { IconLock } from '@/components/icons';
import { cachedOwner, getBackupStatus } from '@/lib/backup';
import { SKINS, symbolSrc } from '@/lib/skins';
import type { Skin, SkinId } from '@/lib/skins';
import { SKIN_UNLOCK, isSkinAvailable } from '@/lib/slots-meta';
import { useFinanceStore } from '@/store';
import { levelFromXp } from '@/lib/slots-meta';
import { selectionChanged } from '@/lib/haptics';
import { fmtDec, fmtNum, skinText, useT } from '@/i18n';

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
    <Sheet title={t('slots.skin.title')} onClose={onClose}>
      <div className="skin-grid">
        {[...SKINS].sort(order).map((sk) => {
          const available = isSkinAvailable(sk, level, topX, granted);
          // Выдан владельцу, а не добыт спином: подпись должна говорить
          // правду, иначе карточка приписывает игроку чужой рекорд.
          const byGrant = !!sk.earn && granted && topX < sk.earn.topX;
          return (
            <button
              key={sk.id}
              className={`skin-card${sk.id === skin ? ' is-active' : ''}${
                available ? '' : ' is-locked'
              }${sk.earn ? ' is-relic' : ''}`}
              data-skin={sk.id}
              disabled={!available}
              onClick={() => pick(sk.id)}
            >
              {/* У заработанного скина карточка живёт своей жизнью: ореол
                  крутится, имя переливается. Всё это — только здесь: если
                  так выглядит каждая карточка, ни одна не выглядит редкой. */}
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
                <img src={symbolSrc(sk.id, 'seven')} width={26} height={26} alt="" />
                <img src={symbolSrc(sk.id, 'star')} width={26} height={26} alt="" />
                <img src={symbolSrc(sk.id, 'bell')} width={26} height={26} alt="" />
              </span>
              <span className="skin-card__name">{skinText(sk.id, 'name')}</span>
              <span className="skin-card__hint">{skinText(sk.id, 'hint')}</span>
              {sk.earn ? (
                <span className={`skin-card__quest${available ? ' is-done' : ''}`}>
                  {byGrant ? (
                    t('slots.skin.grantedNote')
                  ) : available ? (
                    t('slots.skin.earnedBy', { x: fmtX(topX) })
                  ) : (
                    <>
                      {t('slots.skin.relicWhat', { x: sk.earn.topX })}
                      {/* Прогресс обязателен: условие без «сколько уже» — это
                          не цель, а отказ. */}
                      <i
                        className="skin-card__bar"
                        style={{ '--p': Math.min(1, topX / sk.earn.topX) } as React.CSSProperties}
                      >
                        <b />
                      </i>
                      <em>{t('slots.skin.yourBest', { x: fmtX(topX), goal: sk.earn.topX })}</em>
                    </>
                  )}
                </span>
              ) : (
                !available && (
                  <span className="skin-card__lock">
                    <IconLock size={15} />
                    {t('slots.skin.fromLevel', { n: SKIN_UNLOCK[sk.id] })}
                  </span>
                )
              )}
            </button>
          );
        })}
      </div>
      <p className="muted" style={{ marginTop: 14, marginBottom: 0, fontSize: 12 }}>
        {t('slots.skin.note')}
      </p>
    </Sheet>
  );
}
