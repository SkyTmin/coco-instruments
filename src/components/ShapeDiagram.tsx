// Labeled line diagrams for every shape in the «Формулы» section. The labels
// match the input variables (a, b, h, r, θ, …) so it's clear what to enter.
// 2D shapes are drawn filled; 3D shapes as line art. viewBox is 0 0 220 160.
import type { ReactElement } from 'react';

const DIAGRAMS: Record<string, ReactElement> = {
  // ---- 2D ----------------------------------------------------------------
  square: (
    <>
      <path className="body" d="M60 25 H160 V125 H60 Z" />
      <path className="dim" d="M60 125 L160 25" />
      <text x={110} y={142} textAnchor="middle">a</text>
      <text x={140} y={66} textAnchor="middle">d</text>
    </>
  ),
  rectangle: (
    <>
      <path className="body" d="M35 35 H185 V125 H35 Z" />
      <path className="dim" d="M35 125 L185 35" />
      <text x={110} y={142} textAnchor="middle">a</text>
      <text x={198} y={80} textAnchor="middle">b</text>
      <text x={120} y={72} textAnchor="middle">d</text>
    </>
  ),
  triangle: (
    <>
      <path className="body" d="M28 128 L190 128 L120 30 Z" />
      <text x={109} y={144} textAnchor="middle">b</text>
      <text x={168} y={74} textAnchor="middle">a</text>
      <text x={62} y={74} textAnchor="middle">c</text>
    </>
  ),
  isosceles: (
    <>
      <path className="body" d="M40 130 L180 130 L110 28 Z" />
      <path className="dim" d="M110 28 V130" />
      <text x={110} y={146} textAnchor="middle">b</text>
      <text x={60} y={76} textAnchor="middle">a</text>
      <text x={160} y={76} textAnchor="middle">a</text>
      <text x={122} y={92} textAnchor="middle">h</text>
    </>
  ),
  equilateral: (
    <>
      <path className="body" d="M45 128 L175 128 L110 30 Z" />
      <text x={110} y={144} textAnchor="middle">a</text>
      <text x={62} y={78} textAnchor="middle">a</text>
      <text x={158} y={78} textAnchor="middle">a</text>
    </>
  ),
  parallelogram: (
    <>
      <path className="body" d="M30 128 L150 128 L190 38 L70 38 Z" />
      <path className="dim" d="M70 38 V128" />
      <text x={90} y={144} textAnchor="middle">b</text>
      <text x={178} y={86} textAnchor="middle">a</text>
      <text x={80} y={86} textAnchor="middle">h</text>
      <text x={52} y={118} textAnchor="middle">θ</text>
    </>
  ),
  trapezoid: (
    <>
      <path className="body" d="M35 125 L185 125 L150 40 L70 40 Z" />
      <path className="dim" d="M110 40 V125" />
      <text x={110} y={31} textAnchor="middle">a</text>
      <text x={110} y={142} textAnchor="middle">b</text>
      <text x={122} y={86} textAnchor="middle">h</text>
    </>
  ),
  isotrapezoid: (
    <>
      <path className="body" d="M45 125 L175 125 L145 40 L75 40 Z" />
      <path className="dim" d="M110 40 V125" />
      <text x={110} y={31} textAnchor="middle">a</text>
      <text x={110} y={142} textAnchor="middle">b</text>
      <text x={172} y={84} textAnchor="middle">c</text>
      <text x={122} y={86} textAnchor="middle">h</text>
    </>
  ),
  kite: (
    <>
      <path className="body" d="M110 22 L168 78 L110 142 L52 78 Z" />
      <path className="dim" d="M110 22 V142" />
      <path className="dim" d="M52 78 H168" />
      <text x={150} y={46} textAnchor="middle">a</text>
      <text x={152} y={114} textAnchor="middle">b</text>
      <text x={120} y={120} textAnchor="middle">d₁</text>
      <text x={88} y={70} textAnchor="middle">d₂</text>
    </>
  ),
  circle: (
    <>
      <circle className="body" cx={110} cy={80} r={56} />
      <path className="ln" d="M110 80 H166" />
      <circle cx={110} cy={80} r={2.5} className="dot" />
      <text x={138} y={71} textAnchor="middle">r</text>
    </>
  ),
  ellipse: (
    <>
      <ellipse className="body" cx={110} cy={80} rx={78} ry={46} />
      <path className="ln" d="M110 80 H188" />
      <path className="ln" d="M110 80 V34" />
      <circle cx={110} cy={80} r={2.5} className="dot" />
      <text x={150} y={71} textAnchor="middle">r₁</text>
      <text x={123} y={56} textAnchor="middle">r₂</text>
    </>
  ),
  annulus: (
    <>
      <path className="body" fillRule="evenodd" d="M110 80 m-60 0 a60 60 0 1 0 120 0 a60 60 0 1 0 -120 0 Z M110 80 m-32 0 a32 32 0 1 1 64 0 a32 32 0 1 1 -64 0 Z" />
      <path className="ln" d="M110 80 L170 80" />
      <path className="ln" d="M110 80 L110 48" />
      <text x={152} y={72} textAnchor="middle">R</text>
      <text x={122} y={64} textAnchor="middle">r</text>
    </>
  ),
  sector: (
    <>
      <path className="body" d="M55 122 L165 122 A110 110 0 0 0 120 30 Z" />
      <path className="ang" d="M83 122 A28 28 0 0 0 78 105" />
      <text x={108} y={138} textAnchor="middle">r</text>
      <text x={95} y={112} textAnchor="middle">θ</text>
    </>
  ),
  rhombus: (
    <>
      <path className="body" d="M110 26 L176 80 L110 134 L44 80 Z" />
      <path className="dim" d="M110 26 V134" />
      <path className="dim" d="M44 80 H176" />
      <text x={150} y={48} textAnchor="middle">a</text>
      <text x={122} y={110} textAnchor="middle">d₁</text>
      <text x={78} y={72} textAnchor="middle">d₂</text>
    </>
  ),
  polygon: (
    <>
      <path className="body" d="M110 24 L167 65 L145 132 L75 132 L53 65 Z" />
      <text x={110} y={148} textAnchor="middle">s</text>
    </>
  ),

  // ---- 3D (line art) -----------------------------------------------------
  cube: (
    <>
      <path className="ln" d="M48 138 H128 V58 H48 Z" />
      <path className="ln" d="M48 58 L84 32 H164 L128 58" />
      <path className="ln" d="M128 138 L164 112 V32" />
      <path className="dim" d="M128 58 L164 32" />
      <text x={88} y={152} textAnchor="middle">a</text>
    </>
  ),
  cuboid: (
    <>
      <path className="ln" d="M44 136 H150 V70 H44 Z" />
      <path className="ln" d="M44 70 L80 44 H186 L150 70" />
      <path className="ln" d="M150 136 L186 110 V44" />
      <path className="dim" d="M150 70 L186 44" />
      <text x={96} y={150} textAnchor="middle">a</text>
      <text x={174} y={94} textAnchor="middle">c</text>
      <text x={170} y={50} textAnchor="middle">b</text>
    </>
  ),
  cone: (
    <>
      <path className="ln" d="M110 26 L54 120 A60 18 0 0 0 166 120 Z" />
      <path className="dim" d="M54 120 A60 18 0 0 1 166 120" />
      <path className="dim" d="M110 26 V120" />
      <path className="ln" d="M110 120 H166" />
      <text x={120} y={84} textAnchor="middle">h</text>
      <text x={150} y={132} textAnchor="middle">r</text>
      <text x={150} y={74} textAnchor="middle">l</text>
    </>
  ),
  cylinder: (
    <>
      <path className="ln" d="M50 44 V126 A60 18 0 0 0 170 126 V44" />
      <ellipse className="ln" cx={110} cy={44} rx={60} ry={18} />
      <path className="dim" d="M50 126 A60 18 0 0 1 170 126" />
      <path className="ln" d="M110 44 H170" />
      <text x={142} y={36} textAnchor="middle">r</text>
      <text x={60} y={88} textAnchor="middle">h</text>
    </>
  ),
  sphere: (
    <>
      <circle className="ln" cx={110} cy={80} r={58} />
      <ellipse className="dim" cx={110} cy={80} rx={58} ry={18} />
      <path className="ln" d="M110 80 L168 80" />
      <circle cx={110} cy={80} r={2.5} className="dot" />
      <text x={140} y={72} textAnchor="middle">r</text>
    </>
  ),
  ellipsoid: (
    <>
      <ellipse className="ln" cx={110} cy={80} rx={80} ry={46} />
      <ellipse className="dim" cx={110} cy={80} rx={80} ry={16} />
      <path className="dim" d="M110 34 A26 46 0 0 0 110 126" />
      <path className="ln" d="M110 80 H190" />
      <path className="ln" d="M110 80 V34" />
      <text x={158} y={72} textAnchor="middle">a</text>
      <text x={122} y={54} textAnchor="middle">b</text>
      <text x={128} y={104} textAnchor="middle">c</text>
    </>
  ),
  barrel: (
    <>
      <path className="ln" d="M64 40 A70 16 0 0 0 156 40 M64 40 C44 70 44 90 64 120 A70 16 0 0 0 156 120 C176 90 176 70 156 40" />
      <ellipse className="ln" cx={110} cy={40} rx={46} ry={11} />
      <path className="dim" d="M40 80 H180" />
      <text x={110} y={74} textAnchor="middle">D</text>
      <text x={110} y={33} textAnchor="middle">d</text>
      <text x={30} y={82} textAnchor="middle">h</text>
      <path className="dim" d="M24 42 V118" />
    </>
  ),
  'hollow-cylinder': (
    <>
      <path className="ln" d="M50 46 V128 A60 18 0 0 0 170 128 V46" />
      <ellipse className="ln" cx={110} cy={46} rx={60} ry={18} />
      <ellipse className="ln" cx={110} cy={46} rx={30} ry={9} />
      <path className="ln" d="M110 46 H170" />
      <path className="ln" d="M110 46 H140" />
      <text x={150} y={38} textAnchor="middle">R</text>
      <text x={126} y={62} textAnchor="middle">r</text>
      <text x={60} y={90} textAnchor="middle">h</text>
    </>
  ),
  'cone-frustum': (
    <>
      <path className="ln" d="M70 40 L48 122 A62 17 0 0 0 172 122 L150 40" />
      <ellipse className="ln" cx={110} cy={40} rx={40} ry={12} />
      <path className="dim" d="M48 122 A62 17 0 0 1 172 122" />
      <path className="dim" d="M110 40 V122" />
      <path className="ln" d="M110 40 H150" />
      <path className="ln" d="M110 122 H172" />
      <text x={128} y={34} textAnchor="middle">r</text>
      <text x={150} y={114} textAnchor="middle">R</text>
      <text x={120} y={86} textAnchor="middle">h</text>
    </>
  ),
  'pyramid-frustum': (
    <>
      <path className="ln" d="M40 128 L80 46 H150 L190 128 Z" />
      <path className="ln" d="M80 46 L104 36 H174 L150 46" />
      <path className="ln" d="M190 128 L214 118 L174 36" />
      <path className="dim" d="M115 41 V128" />
      <text x={115} y={142} textAnchor="middle">a</text>
      <text x={115} y={33} textAnchor="middle">b</text>
      <text x={126} y={92} textAnchor="middle">h</text>
    </>
  ),
  'hollow-sphere': (
    <>
      <circle className="ln" cx={110} cy={80} r={58} />
      <path className="ln" d="M110 80 m0 -34 a34 34 0 1 0 0.1 0 Z" />
      <path className="ln" d="M110 80 L168 80" />
      <path className="ln" d="M110 80 L110 46" />
      <text x={150} y={72} textAnchor="middle">R</text>
      <text x={122} y={64} textAnchor="middle">r</text>
    </>
  ),
  pyramid: (
    <>
      <path className="ln" d="M118 28 L44 116 L118 150 L192 116 Z" />
      <path className="dim" d="M44 116 L118 86 L192 116" />
      <path className="dim" d="M118 28 L118 116" />
      <text x={72} y={140} textAnchor="middle">l</text>
      <text x={166} y={140} textAnchor="middle">w</text>
      <text x={132} y={84} textAnchor="middle">h</text>
    </>
  ),
  'triangular-pyramid': (
    <>
      <path className="ln" d="M40 130 L180 130 L116 28 Z" />
      <path className="dim" d="M40 130 L132 112 L180 130" />
      <path className="dim" d="M116 28 L120 122" />
      <text x={108} y={144} textAnchor="middle">a</text>
      <text x={128} y={82} textAnchor="middle">h</text>
    </>
  ),
  'pentagonal-pyramid': (
    <>
      <path className="ln" d="M110 24 L46 120 L92 142 L150 138 L182 110 Z" />
      <path className="dim" d="M46 120 L120 128 L182 110" />
      <path className="dim" d="M120 128 L110 24" />
      <text x={64} y={140} textAnchor="middle">s</text>
      <text x={130} y={84} textAnchor="middle">h</text>
    </>
  ),
  'hexagonal-pyramid': (
    <>
      <path className="ln" d="M110 22 L40 110 L78 140 L150 140 L188 110 L110 22 Z" />
      <path className="dim" d="M40 110 L114 124 L188 110" />
      <path className="dim" d="M114 124 L110 22" />
      <path className="dim" d="M78 140 L150 140" />
      <text x={114} y={154} textAnchor="middle">s</text>
      <text x={128} y={78} textAnchor="middle">h</text>
    </>
  ),
  'spherical-sector': (
    <>
      <circle className="ln" cx={110} cy={84} r={56} />
      <ellipse className="dim" cx={110} cy={84} rx={56} ry={17} />
      <path className="ln" d="M110 84 L74 36 A56 56 0 0 1 146 36 Z" />
      <path className="ln" d="M110 84 L110 28" />
      <text x={122} y={56} textAnchor="middle">r</text>
      <text x={150} y={40} textAnchor="middle">h</text>
    </>
  ),
  'triangular-prism': (
    <>
      <path className="ln" d="M40 130 L96 40 L120 130 Z" />
      <path className="ln" d="M96 40 L176 60 L200 138 L120 130" />
      <path className="ln" d="M40 130 L120 130" />
      <path className="dim" d="M40 130 L120 150 L200 138" />
      <text x={66} y={92} textAnchor="middle">h</text>
      <text x={84} y={144} textAnchor="middle">b</text>
      <text x={170} y={112} textAnchor="middle">L</text>
    </>
  ),
  torus: (
    <>
      <ellipse className="ln" cx={110} cy={82} rx={84} ry={44} />
      <ellipse className="ln" cx={110} cy={82} rx={34} ry={14} />
      <path className="dim" d="M110 82 H194" />
      <text x={150} y={74} textAnchor="middle">R</text>
      <text x={110} y={50} textAnchor="middle">r</text>
      <path className="ln" d="M110 82 V38" />
    </>
  ),
};

export function ShapeDiagram({ id, className }: { id: string; className?: string }) {
  const content = DIAGRAMS[id];
  if (!content) return null;
  return (
    <svg
      className={`shape-svg${className ? ` ${className}` : ''}`}
      viewBox="0 0 220 160"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-hidden="true"
    >
      {content}
    </svg>
  );
}

export function hasDiagram(id: string): boolean {
  return id in DIAGRAMS;
}
