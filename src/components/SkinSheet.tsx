// Выбор скина. Скин общий для обеих игр (лежит в сторе как `slotsSkin`),
// поэтому и лист один на всех — «Слоты» и «Каскад» показывают его одинаково.

import { useEffect } from 'react';
import { Sheet } from '@/components/ui';
import { IconLock } from '@/components/icons';
import { SKINS, symbolSrc } from '@/lib/skins';
import type { Skin, SkinId } from '@/lib/skins';
import { SKIN_UNLOCK, isSkinAvailable } from '@/lib/slots-meta';
import { useFinanceStore } from '@/store';
import { levelFromXp } from '@/lib/slots-meta';
import { selectionChanged } from '@/lib/haptics';

/** Заработанный скин — первым: он тут главный приз, а не строчка списка. */
function order(a: Skin, b: Skin): number {
  return (a.earn ? 0 : 1) - (b.earn ? 0 : 1);
}

/** «×83 из ×200» — сколько ещё до «Реликвии». */
const fmtX = (x: number) => `×${x >= 10 ? Math.round(x) : x.toFixed(1)}`;

export function SkinSheet({ onClose }: { onClose: () => void }) {
  const skin = useFinanceStore((s) => s.slotsSkin);
  const xp = useFinanceStore((s) => s.slotsXp);
  const topX = useFinanceStore((s) => s.slotsTopX);
  const setPrefs = useFinanceStore((s) => s.setSlotsPrefs);
  const level = levelFromXp(xp).level;

  const pick = (id: SkinId) => {
    selectionChanged();
    setPrefs({ skin: id });
    onClose();
  };

  // Страховка: если выбранный скин почему-то стал недоступен, возвращаем
  // автомат на «Классику», а не оставляем с символами, которых не выбрать.
  useEffect(() => {
    const cur = SKINS.find((s) => s.id === skin);
    if (cur && !isSkinAvailable(cur, level, topX)) setPrefs({ skin: 'classic' });
  }, [skin, level, topX, setPrefs]);

  return (
    <Sheet title="Скины автомата" onClose={onClose}>
      <div className="skin-grid">
        {[...SKINS].sort(order).map((sk) => {
          const available = isSkinAvailable(sk, level, topX);
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
                  {available ? 'добыто' : 'реликвия'}
                </span>
              )}
              <span className="skin-card__reels">
                <img src={symbolSrc(sk.id, 'seven')} width={26} height={26} alt="" />
                <img src={symbolSrc(sk.id, 'star')} width={26} height={26} alt="" />
                <img src={symbolSrc(sk.id, 'bell')} width={26} height={26} alt="" />
              </span>
              <span className="skin-card__name">{sk.name}</span>
              <span className="skin-card__hint">{sk.hint}</span>
              {sk.earn ? (
                <span className={`skin-card__quest${available ? ' is-done' : ''}`}>
                  {available ? (
                    `добыт спином ${fmtX(topX)}`
                  ) : (
                    <>
                      {sk.earn.what}
                      {/* Прогресс обязателен: условие без «сколько уже» — это
                          не цель, а отказ. */}
                      <i
                        className="skin-card__bar"
                        style={{ '--p': Math.min(1, topX / sk.earn.topX) } as React.CSSProperties}
                      >
                        <b />
                      </i>
                      <em>
                        ваш лучший — {fmtX(topX)} из ×{sk.earn.topX}
                      </em>
                    </>
                  )}
                </span>
              ) : (
                !available && (
                  <span className="skin-card__lock">
                    <IconLock size={15} />с {SKIN_UNLOCK[sk.id]} уровня
                  </span>
                )
              )}
            </button>
          );
        })}
      </div>
      <p className="muted" style={{ marginTop: 14, marginBottom: 0, fontSize: 12 }}>
        «Реликвию» не открывает уровень — её зарабатывают одним крупным спином, и она остаётся
        навсегда. Символы — Twemoji (CC-BY 4.0, Twitter Inc. и контрибьюторы).
      </p>
    </Sheet>
  );
}
