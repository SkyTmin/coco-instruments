import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 24, ...rest }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    ...rest,
  };
}

export const IconWallet = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
);

export const IconShirt = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M20.38 8.57l-1.23 1.85a8 8 0 0 1-6.22 3.58H12a8 8 0 0 1-6.22-3.58L4.55 8.57a2 2 0 0 1 .25-2.57l1.96-1.96A2 2 0 0 1 8.18 3.77c.5 0 .98.2 1.33.55l.71.71a4 4 0 0 0 5.66 0l.71-.71c.35-.35.83-.55 1.33-.55c.5 0 .98.2 1.41.59L21.37 6a2 2 0 0 1 .01 2.57z" />
  </svg>
);

export const IconNotes = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 3h9l3 3v15H6z" />
    <path d="M14 3v4h4M9 11h6M9 15h6M9 19h3" />
  </svg>
);

export const IconGraph = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="6" cy="7" r="3" />
    <circle cx="18" cy="7" r="3" />
    <circle cx="12" cy="17" r="3" />
    <path d="M8.6 8.6l2.8 5.8M15.4 8.6l-2.8 5.8M9 7h6" />
  </svg>
);

export const IconInfo = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5" />
    <path d="M12 7.5h.01" />
  </svg>
);

export const IconPin = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 17v5" />
    <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z" />
  </svg>
);

export const IconDots = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="5" r="1.4" />
    <circle cx="12" cy="12" r="1.4" />
    <circle cx="12" cy="19" r="1.4" />
  </svg>
);

export const IconLink = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

export const IconHash = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" />
  </svg>
);

export const IconSend = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M22 2 11 13" />
    <path d="M22 2 15 22l-4-9-9-4 20-7z" />
  </svg>
);

export const IconPaperclip = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M21.44 11.05 12.2 20.29a6 6 0 0 1-8.49-8.49l9.24-9.24a4 4 0 0 1 5.66 5.66l-9.24 9.24a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
);

export const IconImage = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
  </svg>
);

export const IconPlus = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconList = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
  </svg>
);

export const IconBell = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);

export const IconChevron = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M9 6l6 6-6 6" />
  </svg>
);

export const IconBack = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M19 12H5M12 19l-7-7 7-7" />
  </svg>
);

export const IconPencil = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);

export const IconTrash = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
  </svg>
);

export const IconTarget = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1" />
  </svg>
);

export const IconCalendar = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M16 2v4M8 2v4M3 10h18" />
  </svg>
);

export const IconCheck = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export const IconRuler = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 9.5 9.5 3 21 14.5 14.5 21z" />
    <path d="M7 7l1.5 1.5M10 10l1.5 1.5M13 7l1.5 1.5M10 13l1.5 1.5" />
  </svg>
);

export const IconHeart = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M19 5.5a4.5 4.5 0 0 0-7-1L12 5l-.5-.5a4.5 4.5 0 1 0-6.5 6.2l6.5 6.8 6.5-6.8a4.5 4.5 0 0 0 1-5.2z" />
  </svg>
);

export const IconSparkles = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3l1.7 4.6L18 9l-4.3 1.4L12 15l-1.7-4.6L6 9l4.3-1.4z" />
    <path d="M18.5 14l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" />
  </svg>
);

export const IconChart = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 3v18h18" />
    <path d="M7 14v3M12 9v8M17 5v12" />
  </svg>
);

export const IconSwap = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M7 4 3 8l4 4" />
    <path d="M3 8h14" />
    <path d="m17 20 4-4-4-4" />
    <path d="M21 16H7" />
  </svg>
);

export const IconClock = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.5 2" />
  </svg>
);

export const IconGear = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19.4 13a1.7 1.7 0 0 0 .34 1.87l.05.05a2 2 0 1 1-2.83 2.83l-.05-.05a1.7 1.7 0 0 0-2.87 1.2V19a2 2 0 0 1-4 0v-.08a1.7 1.7 0 0 0-2.87-1.2l-.05.05a2 2 0 1 1-2.83-2.83l.05-.05A1.7 1.7 0 0 0 4.6 13a1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.08a1.7 1.7 0 0 0 1.2-2.87l-.05-.05A2 2 0 1 1 7.06 3.2l.05.05A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.08a1.7 1.7 0 0 0 2.87 1.2l.05-.05a2 2 0 1 1 2.83 2.83l-.05.05A1.7 1.7 0 0 0 19.4 11z" />
  </svg>
);

export const IconCalculator = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="4" y="2.8" width="16" height="18.4" rx="3.2" />
    <path d="M8 7h8" />
    <path d="M8 11h.01M12 11h.01M16 11h.01" />
    <path d="M8 15h.01M12 15h.01M16 15h.01" />
    <path d="M8 19h4M16 19h.01" />
  </svg>
);

export const IconShapes = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M8.5 3l5.5 9.5H3z" />
    <circle cx="16" cy="15.5" r="5" />
  </svg>
);
