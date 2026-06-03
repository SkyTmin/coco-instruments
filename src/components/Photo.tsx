import { useState } from 'react';

/**
 * An image that fades/scales in over a shimmering placeholder once loaded —
 * no harsh pop, no layout shift. Must live inside a positioned, sized parent.
 */
export function Photo({
  src,
  alt = '',
  contain = false,
  className = '',
}: {
  src?: string;
  alt?: string;
  contain?: boolean;
  className?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  return (
    <span className={`ph${contain ? ' ph--contain' : ''}${loaded ? ' is-loaded' : ''}${className ? ` ${className}` : ''}`}>
      <span className="ph__sk" aria-hidden />
      {src && (
        <img
          className="ph__img"
          src={src}
          alt={alt}
          loading="lazy"
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => setLoaded(true)}
        />
      )}
    </span>
  );
}
