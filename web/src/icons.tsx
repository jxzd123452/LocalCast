import type { SVGProps } from 'react';

function Svg(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props} />
  );
}

export function Mark() {
  return (
    <svg className="mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="currentColor" />
      <path d="M8 21c2.2-5 5-7.6 8-7.6S21.8 16 24 21" fill="none" stroke="#ff7a3c" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="16" cy="12.2" r="2" fill="#fffdf8" />
    </svg>
  );
}

export const IconFolder = () => (
  <Svg>
    <path d="M3.5 7.5h6l2 2h9a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 19.5v-10A2 2 0 0 1 4 7.5z" />
  </Svg>
);
export const IconImage = () => (
  <Svg>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <path d="m7 15 3.2-3.2 2.3 2.2 2-2L17 15" />
    <circle cx="9" cy="9" r="1" fill="currentColor" stroke="none" />
  </Svg>
);
export const IconVideo = () => (
  <Svg>
    <rect x="3" y="6" width="13" height="12" rx="2" />
    <path d="m16 10 5-2.5v9L16 14" />
  </Svg>
);
export const IconAudio = () => (
  <Svg>
    <path d="M9 16.5V7.8L18 6v9" />
    <circle cx="7.5" cy="16.5" r="2.2" />
    <circle cx="16.2" cy="15" r="2.2" />
  </Svg>
);
export const IconFile = () => (
  <Svg>
    <path d="M7 3.5h7l5 5V20a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 6 20V5A1.5 1.5 0 0 1 7.5 3.5z" />
    <path d="M14 3.8V9h5" />
  </Svg>
);
export const IconSearch = () => (
  <Svg>
    <circle cx="11" cy="11" r="6" />
    <path d="m16 16 4 4" />
  </Svg>
);
export const IconDownload = () => (
  <Svg>
    <path d="M12 4v10" />
    <path d="m8 10 4 4 4-4" />
    <path d="M5 19h14" />
  </Svg>
);
export const IconSun = () => (
  <Svg>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M18 6l-1.4 1.4M7.4 16.6 6 18" />
  </Svg>
);
export const IconMoon = () => (
  <Svg>
    <path d="M15.5 3.8A7.8 7.8 0 1 0 20.2 14 6.2 6.2 0 0 1 15.5 3.8z" />
  </Svg>
);
