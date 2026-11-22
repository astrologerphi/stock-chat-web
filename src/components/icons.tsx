import type { JSX, SVGAttributes } from 'preact';

type P = SVGAttributes<SVGSVGElement> & { size?: number };

const base = (size = 16): SVGAttributes<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 1.75,
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
  'aria-hidden': true,
});

const icon = (children: JSX.Element) => ({ size, ...rest }: P) => (
  <svg {...base(size)} {...rest}>
    {children}
  </svg>
);

export const Search = icon(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>);
export const Sparkle = icon(<path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M5.6 18.4l2.1-2.1m8.6-8.6 2.1-2.1" />);
export const Bolt = icon(<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />);
export const ChevronDown = icon(<path d="m6 9 6 6 6-6" />);
export const ChevronLeft = icon(<path d="m15 18-6-6 6-6" />);
export const ChevronRight = icon(<path d="m9 18 6-6-6-6" />);
export const ArrowUp = icon(<path d="M12 19V5m-6 6 6-6 6 6" />);
export const ArrowDown = icon(<path d="M12 5v14m6-6-6 6-6-6" />);
export const X = icon(<path d="M18 6 6 18M6 6l12 12" />);
export const Plus = icon(<path d="M12 5v14M5 12h14" />);
export const Check = icon(<path d="m5 12 5 5L20 7" />);
export const Trash = icon(<><path d="M4 7h16M10 11v6m4-6v6" /><path d="M6 7l1 13h10l1-13M9 7V4h6v3" /></>);
export const Eye = icon(<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>);
export const EyeOff = icon(<><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 5.4-1.6" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>);
export const Refresh = icon(<><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" /><path d="M3 12A9 9 0 0 1 18.5 5.8L21 8" /><path d="M21 3v5h-5M3 21v-5h5" /></>);
export const Globe = icon(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>);
export const Building = icon(<><path d="M4 21V5l8-3v19M12 8l8 3v10" /><path d="M8 9h.01M8 13h.01M8 17h.01M16 14h.01M16 18h.01" /></>);
export const Tag = icon(<><path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9Z" /><circle cx="7.5" cy="7.5" r="1.5" /></>);
export const Flame = icon(<path d="M12 22c4 0 7-2.7 7-7 0-4-3-6.5-4-10-2 2-3 4-3 6-1.5-1-2.5-2.5-2.5-4C6 9.5 5 12.5 5 15c0 4.3 3 7 7 7Z" />);
export const Link = icon(<><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" /><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" /></>);
export const Users = icon(<><circle cx="9" cy="8" r="4" /><path d="M2 21a7 7 0 0 1 14 0M16 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6.3" /></>);
export const Maximize = icon(<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />);
export const Settings = icon(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>);
export const Grid = icon(<><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>);
export const Quill = icon(<><path d="M20 4C11 4 6 9 5 20" /><path d="M20 4c0 7-4 11-11 11" /></>);
export const Cloud = icon(<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />);
export const Database = icon(<><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>);
export const Key = icon(<><circle cx="7.5" cy="15.5" r="4.5" /><path d="m10.7 12.3 9.3-9.3M17 6l3 3M14 9l2 2" /></>);
export const Sun = icon(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>);
export const Moon = icon(<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" />);
export const Layers = icon(<><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></>);
export const Rows = icon(<path d="M4 6h16M4 12h16M4 18h16" />);
export const Clock = icon(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>);
export const Stack = icon(<><rect x="4" y="9" width="16" height="11" rx="2" /><path d="M7 6h10M9 3h6" /></>);
export const TrendLine = icon(<><path d="M3 3v18h18" /><path d="m7 15 4-5 3 3 6-7" /></>);
export const PieChart = icon(<><path d="M21 12A9 9 0 1 1 12 3v9h9Z" /><path d="M15 3.5A9 9 0 0 1 20.5 9H15V3.5Z" /></>);
