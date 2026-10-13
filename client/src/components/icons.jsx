// Bộ icon nét mảnh, bo tròn — đồng bộ với nét vẽ của logo Finora
const S = ({ children, ...p }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...p}>
    {children}
  </svg>
);

export const IconHome = (p) => (
  <S {...p}><path d="M4 11.5 12 5l8 6.5" /><path d="M6 10v9h12v-9" /><path d="M10 19v-5h4v5" /></S>
);
export const IconHive = (p) => (
  <S {...p}>
    <path d="m8 3.5 3.5 2v4L8 11.5l-3.5-2v-4Z" />
    <path d="m16 3.5 3.5 2v4L16 11.5l-3.5-2v-4Z" />
    <path d="m12 11.5 3.5 2v4L12 19.5l-3.5-2v-4Z" />
  </S>
);
export const IconList = (p) => (
  <S {...p}><path d="M7 4h10a1 1 0 0 1 1 1v15l-3-2-3 2-3-2-3 2V5a1 1 0 0 1 1-1Z" /><path d="M9 9h6M9 13h4" /></S>
);
export const IconChat = (p) => (
  <S {...p}><path d="M5 18.5V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H8.5Z" /><path d="M9 10h6M9 13h3" /></S>
);
export const IconJar = (p) => (
  <S {...p}><path d="M8 3.5h8M9 3.5v2.5L6.5 9v9a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2V9L15 6V3.5" /><path d="M6.5 13h11" /></S>
);
export const IconFlower = (p) => (
  <S {...p}>
    <circle cx="12" cy="9" r="2" />
    <path d="M12 7c0-2.5 3-3 3-0.5S12 9 12 9M12 11c0 2.5 3 3 3 .5S12 9 12 9M12 7c0-2.5-3-3-3-.5S12 9 12 9M12 11c0 2.5-3 3-3 .5S12 9 12 9" />
    <path d="M12 11v9M12 17c-2.5 0-4-1.5-4-3.5 2 0 4 1.5 4 3.5Z" />
  </S>
);
export const IconWallet = (p) => (
  <S {...p}><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H17v3" /><rect x="4" y="8" width="16" height="11" rx="2" /><path d="M16 13.5h1.5" /></S>
);
export const IconTag = (p) => (
  <S {...p}><path d="M4 12.5V5h7.5l8.5 8.5-7.5 7.5Z" /><circle cx="8.3" cy="9.3" r="1.2" /></S>
);
export const IconMore = (p) => (
  <S {...p}><circle cx="6" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="18" cy="12" r="1.2" /></S>
);
export const IconPlus = (p) => (
  <S {...p}><path d="M12 5v14M5 12h14" /></S>
);

/** Chú ong theo phong cách logo Finora */
export function Bee({ size = 56, className = '', style }) {
  return (
    <svg viewBox="0 0 120 100" width={size} height={size * (100 / 120)} className={className} style={style} aria-hidden>
      <path className="bee-body" d="M22 66c-6-16 6-32 30-38 22-5 44-2 52 14 6 13 1 25-14 32-18 9-56 13-68-8Z" />
      <path className="bee-wing" d="M54 30C40 14 24 12 23 22c-1 12 18 16 31 8Z" />
      <path className="bee-wing" d="M54 30C50 12 58 2 64 6c7 4 2 18-10 24Z" />
      <path className="bee-line" d="M54 30c12 14 16 30 8 48" />
      <path className="bee-line" d="M76 30c10 10 12 26 4 40" />
      <path className="bee-line" d="M101 50c6 1 11-1 15-6" />
      <circle className="bee-eye" cx="36" cy="58" r="5" />
    </svg>
  );
}
