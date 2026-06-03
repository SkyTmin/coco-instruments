import type { CSSProperties } from 'react';
import type { WardrobeItem } from '@/types';
import { CATEGORY_EMOJI } from '@/lib/clothing';
import { attachmentHref } from '@/lib/images';
import { Photo } from '@/components/Photo';

/** The one wardrobe tile used everywhere (grid, outfit, shuffle) for a
 *  consistent photo-forward look with a name overlay. */
export function WardrobeCard({
  item,
  onClick,
  style,
  badge,
}: {
  item: WardrobeItem;
  onClick: () => void;
  style?: CSSProperties;
  badge?: string;
}) {
  return (
    <button type="button" className="wardrobe-card" style={style} onClick={onClick}>
      {item.photo ? (
        <Photo src={attachmentHref(item.photo)} />
      ) : (
        <span className="wardrobe-card__ph">{CATEGORY_EMOJI[item.category]}</span>
      )}
      <span className="wardrobe-card__overlay">
        <span className="wardrobe-card__name">{item.name}</span>
        {badge && <span className="wardrobe-card__badge">{badge}</span>}
      </span>
    </button>
  );
}
