// Подсказки при наведении — только мышью (`data-input=mouse`): на телефоне
// «наведения» нет, а у геймпада и клавиатуры свои значки кнопок.
// Разметка: `data-tip="Питомцы"` и необязательный `data-tip-key="pets"` —
// к тексту добавится текущая клавиша: «Питомцы · P».

import { useEffect, useState } from 'react';
import type { Action } from '@/input/actions';
import { getInputDevice } from '@/input/device';
import { hintTitle } from '@/input/Prompt';

interface Tip {
  text: string;
  x: number;
  y: number;
  below: boolean;
}

export function TipHost() {
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    let timer = 0;
    let cur: HTMLElement | null = null;
    const hide = () => {
      window.clearTimeout(timer);
      cur = null;
      setTip(null);
    };
    const over = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || getInputDevice() !== 'mouse') return;
      const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>('[data-tip]') ?? null;
      if (el === cur) return;
      hide();
      if (!el) return;
      cur = el;
      timer = window.setTimeout(() => {
        if (cur !== el || !el.isConnected) return;
        const r = el.getBoundingClientRect();
        const key = el.dataset.tipKey as Action | undefined;
        const raw = el.dataset.tip ?? '';
        const text = key ? hintTitle(raw, key) : raw;
        if (!text) return;
        const below = r.top < 48;
        setTip({ text, x: r.left + r.width / 2, y: below ? r.bottom + 6 : r.top - 6, below });
      }, 350);
    };
    window.addEventListener('pointerover', over, true);
    window.addEventListener('pointerdown', hide, true);
    window.addEventListener('keydown', hide, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      hide();
      window.removeEventListener('pointerover', over, true);
      window.removeEventListener('pointerdown', hide, true);
      window.removeEventListener('keydown', hide, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  if (!tip) return null;
  const left = Math.max(8, Math.min(window.innerWidth - 8, tip.x));
  return (
    <div
      className={`gs-tip${tip.below ? ' is-below' : ''}`}
      style={{ left, top: tip.y }}
      role="tooltip"
    >
      {tip.text}
    </div>
  );
}
