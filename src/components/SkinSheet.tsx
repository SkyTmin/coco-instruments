// Выбор скина. Скин общий для обеих игр (лежит в сторе как `slotsSkin`),
// поэтому и лист один на всех — «Слоты» и «Каскад» показывают его одинаково.

import { useEffect, useState } from 'react';
import { Sheet } from '@/components/ui';
import { IconLock } from '@/components/icons';
import { SKINS, symbolSrc } from '@/lib/skins';
import type { Skin, SkinId } from '@/lib/skins';
import { SKIN_UNLOCK, isSkinAvailable } from '@/lib/slots-meta';
import { limitLabel, windowState } from '@/lib/skin-limits';
import { useFinanceStore } from '@/store';
import { levelFromXp } from '@/lib/slots-meta';
import { selectionChanged } from '@/lib/haptics';

/** Лимитированные — вперёд: окно закроется, а уровень подождёт. */
function order(a: Skin, b: Skin, now: number): number {
  const live = (s: Skin) => (s.limited && windowState(s.limited, now).open ? 0 : 1);
  return live(a) - live(b);
}

export function SkinSheet({ onClose }: { onClose: () => void }) {
  const skin = useFinanceStore((s) => s.slotsSkin);
  const xp = useFinanceStore((s) => s.slotsXp);
  const owned = useFinanceStore((s) => s.slotsSkinsOwned);
  const setPrefs = useFinanceStore((s) => s.setSlotsPrefs);
  const level = levelFromXp(xp).level;
  // Дата берётся один раз за открытие листа: пересчитывать её каждую секунду
  // незачем, окна меряются днями.
  const [now] = useState(() => Date.now());

  const pick = (id: SkinId) => {
    selectionChanged();
    setPrefs({ skin: id });
    onClose();
  };

  // Если окно лимитированного скина закрылось, пока им играли, и забрать его
  // не успели — тихо возвращаем на классику. Иначе автомат остался бы с
  // символами, которых игрок уже не может выбрать заново.
  useEffect(() => {
    const cur = SKINS.find((s) => s.id === skin);
    if (cur && !isSkinAvailable(cur, level, owned, now)) setPrefs({ skin: 'classic' });
  }, [skin, level, owned, now, setPrefs]);

  return (
    <Sheet title="Скины автомата" onClose={onClose}>
      <div className="skin-grid">
        {[...SKINS]
          .sort((a, b) => order(a, b, now))
          .map((sk) => {
            const available = isSkinAvailable(sk, level, owned, now);
            const has = owned.includes(sk.id);
            const win = sk.limited ? windowState(sk.limited, now) : null;
            return (
              <button
                key={sk.id}
                className={`skin-card${sk.id === skin ? ' is-active' : ''}${
                  available ? '' : ' is-locked'
                }${sk.limited ? ' is-limited' : ''}`}
                data-skin={sk.id}
                disabled={!available}
                onClick={() => pick(sk.id)}
              >
                {/* Метка лимита стоит над карточкой и видна до всего
                    остального: она объясняет, почему этот скин надо брать
                    сейчас, а не когда-нибудь. */}
                {sk.limited && (
                  <span className={`skin-card__limit${win?.open ? ' is-live' : ''}`}>
                    {has ? 'ваш' : win?.open ? 'лимит' : win?.gone ? 'ушёл' : 'ждёт'}
                  </span>
                )}
                <span className="skin-card__reels">
                  <img src={symbolSrc(sk.id, 'seven')} width={26} height={26} alt="" />
                  <img src={symbolSrc(sk.id, 'star')} width={26} height={26} alt="" />
                  <img src={symbolSrc(sk.id, 'bell')} width={26} height={26} alt="" />
                </span>
                <span className="skin-card__name">{sk.name}</span>
                <span className="skin-card__hint">{sk.hint}</span>
                {sk.limited ? (
                  <span className={`skin-card__clock${win?.open && !has ? ' is-hot' : ''}`}>
                    {limitLabel(sk.limited, has, now)}
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
        Лимитированный скин остаётся вашим навсегда, если успеть выбрать его, пока открыто окно.
        Сезонный вернётся через год, дроп — больше никогда. Символы — Twemoji (CC-BY 4.0, Twitter
        Inc. и контрибьюторы).
      </p>
    </Sheet>
  );
}
