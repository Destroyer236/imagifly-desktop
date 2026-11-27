const ICONS = {
  sparkle: `<path d="M12 3.4l1.9 5.2L19 10.5l-5.1 1.9L12 17.6l-1.9-5.2L5 10.5l5.1-1.9z"/><path d="M18.4 14.4l.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8z"/>`,
  image: `<rect x="3" y="4.5" width="18" height="15" rx="3"/><path d="M3 16l4.6-4.6 3.4 3.4 3.1-3.1L21 18"/><circle cx="8.4" cy="9" r="1.4"/>`,
  movie: `<rect x="3" y="4.5" width="18" height="15" rx="3"/><path d="M10 9l5 3-5 3z"/>`,
  library: `<rect x="4" y="3.5" width="12.5" height="17" rx="2.5"/><path d="M9 3.5v17M20 6.5v9.5"/>`,
  globe: `<circle cx="12" cy="12" r="8.4"/><path d="M3.6 12h16.8M12 3.6c2.4 2.4 2.4 14.4 0 16.8M12 3.6c-2.4 2.4-2.4 14.4 0 16.8"/>`,
  person: `<circle cx="12" cy="8" r="3.6"/><path d="M4.8 20c0-3.6 3.2-5.6 7.2-5.6s7.2 2 7.2 5.6"/>`,
  code: `<path d="M9 7l-5 5 5 5M15 7l5 5-5 5"/>`,
  sun: `<circle cx="12" cy="12" r="4"/><path d="M12 2.6v2.1M12 19.3v2.1M2.6 12h2.1M19.3 12h2.1M5.3 5.3l1.5 1.5M17.2 17.2l1.5 1.5M18.7 5.3l-1.5 1.5M6.8 17.2l-1.5 1.5"/>`,
  moon: `<path d="M20 14.6A8.4 8.4 0 0 1 9.4 4 8.4 8.4 0 1 0 20 14.6z"/>`,
  refresh: `<path d="M20 11a8 8 0 1 0-2.35 6.05"/><path d="M20 5.5V11h-5.5"/>`,
  plus: `<path d="M12 5v14M5 12h14"/>`,
  close: `<path d="M6 6l12 12M18 6L6 18"/>`,
  download: `<path d="M12 3.5v11M7.5 10.5L12 15l4.5-4.5M4.5 19.5h15"/>`,
  trash: `<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5M10.5 10.5v6M13.5 10.5v6"/>`,
  copy: `<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 5.5V4.8A1.8 1.8 0 0 0 14.2 3H5.8A1.8 1.8 0 0 0 4 4.8v8.4A1.8 1.8 0 0 0 5.8 15h.7"/>`,
  check: `<path d="M4.5 12.5l5 5 10-10"/>`,
  chevronDown: `<path d="M6 9l6 6 6-6"/>`,
  chevronLeft: `<path d="M15 5l-7 7 7 7"/>`,
  chevronRight: `<path d="M9 5l7 7-7 7"/>`,
  chevronUp: `<path d="M6 15l6-6 6 6"/>`,
  send: `<path d="M21 3L10.5 13.5M21 3l-7 18-3.5-7.5L3 10z"/>`,
  logout: `<path d="M14 4.5h-8a1.5 1.5 0 0 0-1.5 1.5v12a1.5 1.5 0 0 0 1.5 1.5h8"/><path d="M17 8l4 4-4 4M9 12h12"/>`,
  key: `<circle cx="8" cy="8" r="4"/><path d="M11 11l8 8M16 16l2-2M14 14l2-2"/>`,
  link: `<path d="M9.5 14.5l5-5"/><path d="M7.5 17a4 4 0 0 1 0-5.7l2.2-2.2M16.5 7a4 4 0 0 1 0 5.7l-2.2 2.2"/>`,
  bell: `<path d="M6 9a6 6 0 0 1 12 0c0 5 2 5 2 6.5H4C4 14 6 14 6 9z"/><path d="M10 19.5a2.2 2.2 0 0 0 4 0"/>`,
  card: `<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18M6.5 15h4"/>`,
  gift: `<path d="M4 9h16v3H4zM5.5 12v7.5h13V12M12 9v10.5"/><path d="M12 9c-1-3-2.5-4.5-4.5-3.5S7 9 12 9zM12 9c1-3 2.5-4.5 4.5-3.5S17 9 12 9z"/>`,
  edit: `<path d="M4.5 19.5l.9-4.2L16 4.7a2 2 0 0 1 2.8 0l.5.5a2 2 0 0 1 0 2.8L8.7 18.6z"/><path d="M14.5 6.5l3 3"/>`,
  camera: `<path d="M4 8h3l1.5-2.5h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.2"/>`,
  lock: `<rect x="4.5" y="10" width="15" height="10.5" rx="2.5"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/>`,
  external: `<path d="M13 4.5h6.5V11M19.5 4.5L11 13"/><path d="M17 14v5a1.5 1.5 0 0 1-1.5 1.5H4.5A1.5 1.5 0 0 1 3 19V8a1.5 1.5 0 0 1 1.5-1.5H10"/>`,
  play: `<path d="M7 4.5l13 7.5-13 7.5z"/>`,
  heart: `<path d="M12 20.3S4 15.4 4 9.6A4.6 4.6 0 0 1 12 6a4.6 4.6 0 0 1 8 3.6c0 5.8-8 10.7-8 10.7z"/>`,
  flag: `<path d="M5 21V4c4-2.5 8 2.5 14 0v9c-6 2.5-10-2.5-14 0"/>`,
  more: `<circle cx="6" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18" cy="12" r="1.3"/>`,
  folder: `<path d="M3 7.5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>`,
  clock: `<circle cx="12" cy="12" r="8.4"/><path d="M12 7v5.3l3.5 2"/>`,
  info: `<circle cx="12" cy="12" r="8.4"/><path d="M12 11v6M12 7.5v.1"/>`,
  warning: `<path d="M12 3.5L21 19.5H3z"/><path d="M12 9v4.5M12 16.6v.1"/>`,
  eye: `<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>`,
  eyeOff: `<path d="M3 3l18 18"/><path d="M10.6 6.1A9 9 0 0 1 12 6c6 0 9.5 6 9.5 6a15 15 0 0 1-2.2 2.7M6.4 7.4A15 15 0 0 0 2.5 12S6 18 12 18c1.2 0 2.3-.2 3.3-.6"/><path d="M9.5 9.5a3 3 0 0 0 4.2 4.2"/>`,
  tune: `<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>`,
  star: `<path d="M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4.1-4 5.7-.8z"/>`,
  checkCircle: `<circle cx="12" cy="12" r="8.4"/><path d="M8 12l2.8 2.8L16.5 9"/>`,
  alert: `<circle cx="12" cy="12" r="8.4"/><path d="M12 7.5v5M12 16v.1"/>`,
  cloudOff: `<path d="M3 3l18 18"/><path d="M8 7.5a4 4 0 0 0-1.5 7.7h11.4a3.5 3.5 0 0 0 1.3-.3"/><path d="M9 18h9"/>`,
  userPlus: `<circle cx="10" cy="8" r="3.4"/><path d="M3 19c0-3.4 3-5.3 7-5.3s7 1.9 7 5.3"/><path d="M19 7v6M16 10h6"/>`,
  history: `<path d="M4 12a8 8 0 1 0 2.5-5.8"/><path d="M4 4v4.5H8.5"/><path d="M12 8v4.5l3 1.8"/>`,
  login: `<path d="M14 4.5h-8a1.5 1.5 0 0 0-1.5 1.5v12a1.5 1.5 0 0 0 1.5 1.5h8"/><path d="M10 12h11M17 8l4 4-4 4"/>`,
  layers: `<path d="M12 3.5l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5M3 17l9 5 9-5"/>`,
  grid: `<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>`,
  list: `<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>`,
  bolt: `<path d="M13 2.5L5 14h6L11 21.5 19 10h-6z"/>`,
  speed: `<path d="M4.2 17.5a8 8 0 1 1 15.6 0"/><path d="M12 12.2l4.4-3.4"/><circle cx="12" cy="12.2" r="1.2"/>`,
  palette: `<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.8-.9 1.8-1.9 0-1.5-1.5-1.9-1.5-3.1 0-.9.8-1.5 1.8-1.5h1.4A6 6 0 0 0 20.5 12 8.5 8.5 0 0 0-8.5-8.5z"/><circle cx="7.5" cy="10" r="1"/><circle cx="9.5" cy="6.8" r="1"/><circle cx="14" cy="6.5" r="1"/>`,
  share: `<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.3 10.8l7.4-3.6M8.3 13.2l7.4 3.6"/>`,
  stop: `<rect x="6" y="6" width="12" height="12" rx="2.5"/>`,
  minimize: `<path d="M5 12h14"/>`,
  maximize: `<rect x="5.5" y="5.5" width="13" height="13" rx="1.4"/>`,
  restore: `<rect x="8" y="8" width="10.5" height="10.5" rx="1.2"/><path d="M10.5 8V6.5A1.5 1.5 0 0 1 12 5h5.5A1.5 1.5 0 0 1 19 6.5V12a1.5 1.5 0 0 1-1.5 1.5H16"/>`,
  dot: `<circle cx="12" cy="12" r="3.5"/>`,
};

export function icon(name, size = 24, weight = 1.8) {
  const raw = ICONS[name] || ICONS.info;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${weight}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${raw}</svg>`;
}

export function brandMark(size = 38) {
  return `<svg class="mark" viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true">
    <defs><linearGradient id="bm${size}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6FC0FF"/><stop offset="1" stop-color="#0066CC"/></linearGradient></defs>
    <rect x="2" y="2" width="60" height="60" rx="20" fill="url(#bm${size})"/>
    <path d="M32 13l4.2 11.4L47 29l-10.8 4.6L32 45l-4.2-11.4L17 29l10.2-4.6z" fill="#fff" opacity=".95"/>
    <path d="M47.5 16.5l1.6 4.2 4.2 1.6-4.2 1.6-1.6 4.2-1.6-4.2-4.2-1.6 4.2-1.6z" fill="#DFF3FF"/>
  </svg>`;
}
