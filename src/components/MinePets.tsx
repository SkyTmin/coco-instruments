// Отряд питомцев на кромке поля шахты (v2.72). Сидят и живут своей манерой,
// тап — погладить (радость и сердечки, раз в десять минут опыт); трюк играет
// анимацию работы вида (v2.73). Каждый в отряде раз в
// `TRICK_EVERY` сломанных блоков делает свой трюк: стор решает, что принёс
// (`prisonPetTrick`), страница — что происходит на поле (`onTrick`).
//
// Трюк считается от работы, а не по часам: пока копаешь, копают и они.

import { useEffect, useRef, useState } from 'react';
import { PetArt } from '@/components/PetArt';
import { useFinanceStore } from '@/store';
import type { PetTrick } from '@/store';
import { shortMoney } from '@/lib/prison';
import { TRICK_EVERY } from '@/lib/pets';
import type { PetId } from '@/lib/pets';
import { petPat, petTrick, primeAudio } from '@/lib/sound';
import { tapLight } from '@/lib/haptics';

/** Надпись над питомцем по итогу трюка. */
function bubble(t: PetTrick): string {
  switch (t.role) {
    case 'loot':
      return t.ore ? `+${t.ore.units} руды` : `+${t.tokens} ✦`;
    case 'sell':
      return t.coins ? `+${shortMoney(t.coins)}` : `+${t.tokens} ✦`;
    case 'token':
      return `+${t.tokens} ✦`;
    case 'dmg':
      return 'Подмога!';
    case 'rate':
      return 'Разгон!';
    case 'luck':
      return t.sense ? (t.sense.below ? `Чую! ↓${t.sense.below}` : 'Чую!') : `+${t.tokens} ✦`;
  }
}

export function MinePets({
  onTrick,
  onPat,
}: {
  onTrick: (t: PetTrick, el: HTMLElement | null) => void;
  onPat?: (id: PetId, xp: boolean) => void;
}) {
  const squad = useFinanceStore((s) => s.prison.squad);
  const pets = useFinanceStore((s) => s.prison.pets);
  const mined = useFinanceStore((s) => s.prison.mined);
  const trick = useFinanceStore((s) => s.prisonPetTrick);
  const pat = useFinanceStore((s) => s.prisonPetPat);
  const [joy, setJoy] = useState<number[]>([0, 0, 0]);
  const [tricks, setTricks] = useState<number[]>([0, 0, 0]);
  const [said, setSaid] = useState<(string | null)[]>([null, null, null]);
  const els = useRef<(HTMLSpanElement | null)[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const cb = useRef(onTrick);
  cb.current = onTrick;
  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
    },
    [],
  );

  const cheer = (i: number, text: string | null, happy = true) => {
    if (happy) setJoy((j) => j.map((x, k) => (k === i ? x + 1 : x)));
    if (text) {
      setSaid((s) => s.map((x, k) => (k === i ? text : x)));
      timers.current.push(
        setTimeout(() => setSaid((s) => s.map((x, k) => (k === i ? null : x))), 1500),
      );
    }
  };

  // Трюк — когда питомец накопил работы. Проверяем по сломанным блокам: стор
  // сам откажет, если время не пришло.
  useEffect(() => {
    const st = useFinanceStore.getState().prison;
    st.squad.forEach((_, i) => {
      const last = st.tricks[i] ?? st.mined - TRICK_EVERY;
      if (st.mined - last < TRICK_EVERY) return;
      const t = trick(i);
      if (!t) return;
      petTrick();
      setTricks((j) => j.map((x, k) => (k === i ? x + 1 : x)));
      cheer(i, bubble(t), false);
      cb.current(t, els.current[i]);
    });
    // Только по сломанным блокам.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mined]);

  if (!squad.length) return null;
  return (
    <div className="ppets" aria-label="Питомцы">
      {squad.map((id, i) => {
        const rec = pets[id];
        if (!rec) return null;
        return (
          <span key={id} className="ppets__pet" ref={(el) => (els.current[i] = el)}>
            <PetArt
              id={id}
              size={44}
              v={rec.v}
              joy={joy[i]}
              trick={tricks[i]}
              onClick={() => {
                primeAudio();
                petPat();
                tapLight();
                const xp = pat(id);
                cheer(i, xp ? '+опыт' : null);
                onPat?.(id, xp);
              }}
            />
            {said[i] && (
              <b key={`${joy[i]}:${tricks[i]}`} className="ppets__say">
                {said[i]}
              </b>
            )}
          </span>
        );
      })}
    </div>
  );
}
