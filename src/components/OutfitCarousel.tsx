import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Outfit } from '@/types';
import { Photo } from '@/components/Photo';
import { attachmentHref } from '@/lib/images';
import { pluralizeRu } from '@/lib/format';
import { selectionChanged } from '@/lib/haptics';

/** Swipeable, snap-to-centre carousel of outfits. The centred card scales up. */
export function OutfitCarousel({ outfits }: { outfits: Outfit[] }) {
  const navigate = useNavigate();
  const trackRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const cards = Array.from(track.querySelectorAll<HTMLElement>('.qp-card'));
    if (!cards.length) return;
    let mounted = false;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const focus = e.intersectionRatio > 0.78;
          // Haptic tick when a new card snaps into focus (not on initial mount).
          if (focus && mounted && !e.target.classList.contains('is-focus')) selectionChanged();
          e.target.classList.toggle('is-focus', focus);
        }
        mounted = true;
      },
      { root: track, threshold: [0.4, 0.6, 0.78, 0.92] },
    );
    cards.forEach((c) => io.observe(c));
    // Focus the first card initially.
    cards[0]?.classList.add('is-focus');
    return () => io.disconnect();
  }, [outfits]);

  return (
    <div className="qp-track" ref={trackRef}>
      {outfits.map((o, index) => (
        <button
          key={o.id}
          className="qp-card"
          style={{ animationDelay: `${Math.min(index, 5) * 60}ms` }}
          onClick={() => {
            selectionChanged();
            navigate(`/clothing/outfits/${o.id}`);
          }}
        >
          {o.cover ? (
            <Photo src={attachmentHref(o.cover)} />
          ) : (
            <span className="qp-card__ph">🧥</span>
          )}
          <span className="qp-card__overlay">
            <span className="qp-card__name">{o.name}</span>
            <span className="qp-card__count">
              {o.itemIds.length} {pluralizeRu(o.itemIds.length, ['вещь', 'вещи', 'вещей'])}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
