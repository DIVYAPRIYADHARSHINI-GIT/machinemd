// Minimal inline icon set (stroke icons, 24px grid) - no icon library dependency.
const PATHS = {
  dashboard: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
  machines: 'M4 7h16v10H4zM8 17v3m8-3v3M7 11h2m3 0h5',
  data: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zm0 0v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6',
  lab: 'M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 006 21h12a1.7 1.7 0 001.5-2.5L14 9V3M7 15h10',
  whatif: 'M4 21v-7m0-4V3m8 18v-9m0-4V3m8 18v-5m0-4V3M1 14h6m2-6h6m2 8h6',
  alerts: 'M12 3a6 6 0 00-6 6v4l-2 3h16l-2-3V9a6 6 0 00-6-6zm-2 16a2 2 0 004 0',
  maintenance: 'M14.7 6.3a4 4 0 00-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 005.4-5.4l-2.6 2.6-2.4-.6-.6-2.4 2.6-2.6z',
  reports: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6m-6 4h6',
  users: 'M16 19v-1a4 4 0 00-4-4H6a4 4 0 00-4 4v1M9 10a3 3 0 100-6 3 3 0 000 6zm13 9v-1a4 4 0 00-3-3.9M16 4.1a3 3 0 010 5.8',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zm7.4-3a7.4 7.4 0 00-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 00-2-1.2L14.5 3h-4L10 5.6a7.6 7.6 0 00-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 000 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 002 1.2l.5 2.6h4l.4-2.6a7.6 7.6 0 002-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'M6 6l12 12M18 6L6 18',
  sun: 'M12 17a5 5 0 100-10 5 5 0 000 10zM12 1v2m0 18v2M4.2 4.2l1.4 1.4m12.8 12.8l1.4 1.4M1 12h2m18 0h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z',
  logout: 'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4m7 14l5-5-5-5m5 5H9',
  search: 'M11 19a8 8 0 100-16 8 8 0 000 16zm10 2l-4.3-4.3',
  download: 'M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2',
  upload: 'M12 21V9m0 0l-4 4m4-4l4 4M4 7V5a2 2 0 012-2h12a2 2 0 012 2v2',
  plus: 'M12 5v14M5 12h14',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  trash: 'M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3',
  check: 'M5 13l4 4L19 7',
  arrowLeft: 'M19 12H5m6-6l-6 6 6 6',
  chevronRight: 'M9 6l6 6-6 6',
  sort: 'M8 9l4-4 4 4M16 15l-4 4-4-4',
  info: 'M12 22a10 10 0 100-20 10 10 0 000 20zm0-14h.01M11 12h1v5h1',
  warning: 'M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
  refresh: 'M4 4v6h6M20 20v-6h-6M5.6 15A8 8 0 0019 17m-14-10A8 8 0 0118.4 9',
  pulse: 'M3 12h4l3-8 4 16 3-8h4',
  shield: 'M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3z',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7l1-8z',
  clock: 'M12 22a10 10 0 100-20 10 10 0 000 20zm0-15v5l3 3',
  file: 'M7 3h7l5 5v13H7zM14 3v5h5',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zm11 3a3 3 0 100-6 3 3 0 000 6z',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 018 0v4',
  activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
};

export default function Icon({ name, className = 'h-5 w-5', strokeWidth = 1.8, title }) {
  const d = PATHS[name] || PATHS.info;
  const filled = name === 'dashboard';
  return (
    <svg viewBox="0 0 24 24" className={className} fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      <path d={d} />
    </svg>
  );
}
