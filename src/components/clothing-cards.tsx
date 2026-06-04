import type { CSSProperties } from 'react';
import type { Collection, WardrobeItem } from '@/types';
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

/** A collection tile with a mosaic preview of its first items. */
export function CollectionTile({
  collection,
  byId,
  onClick,
  style,
}: {
  collection: Collection;
  byId: Map<string, WardrobeItem>;
  onClick: () => void;
  style?: CSSProperties;
}) {
  const items = collection.itemIds
    .map((iid) => byId.get(iid))
    .filter((w): w is WardrobeItem => Boolean(w))
    .slice(0, 4);
  const count = Math.max(1, Math.min(items.length, 4));
  return (
    <button type="button" className="collection-tile" style={style} onClick={onClick}>
      <div className="collection-mosaic" data-count={count}>
        {items.length ? (
          items.map((it, k) => (
            <span key={k} className="collection-mosaic__cell">
              {it.photo ? (
                <Photo src={attachmentHref(it.photo)} />
              ) : (
                <span className="collection-mosaic__ph">{CATEGORY_EMOJI[it.category]}</span>
              )}
            </span>
          ))
        ) : (
          <span className="collection-mosaic__empty">{collection.emoji || '🗂'}</span>
        )}
      </div>
      <div className="collection-tile__meta">
        <span className="collection-tile__name">
          {collection.emoji ? `${collection.emoji} ` : ''}
          {collection.name}
        </span>
        <span className="collection-tile__count">{collection.itemIds.length}</span>
      </div>
    </button>
  );
}
