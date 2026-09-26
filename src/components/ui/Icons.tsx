/** Small geometric line icons (1.6px stroke, 20px box). Decorative: aria-hidden. */
type P = { className?: string };
const base = (className = "h-5 w-5") => ({
  className,
  viewBox: "0 0 20 20",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export const IconRadar = ({ className }: P) => (
  <svg {...base(className)}>
    <circle cx="9" cy="9" r="6" />
    <path d="m13.5 13.5 3.5 3.5M9 5.5v1.3M9 11.2v1.3M5.5 9h1.3M11.2 9h1.3" />
  </svg>
);
export const IconSparkles = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M9 2.5 10.4 7 15 8.5l-4.6 1.4L9 14.5 7.6 9.9 3 8.5 7.6 7z" />
    <path d="M15.5 12.5 16 14l1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5z" />
  </svg>
);
export const IconBolt = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M11 2 4.5 11H10l-1 7 6.5-9H10z" />
  </svg>
);
export const IconPortfolio = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M4 16V9M8 16V5M12 16v-5M16 16V7" />
  </svg>
);
export const IconWallet = ({ className }: P) => (
  <svg {...base(className)}>
    <rect x="2.5" y="5" width="15" height="11" rx="2.5" />
    <path d="M13 10.5h4.5M5.5 5l7.5-2.5 1 2.5" />
  </svg>
);
export const IconPulse = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M2 10h3.5l2-5 3 10 2-5H18" />
  </svg>
);
export const IconShield = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M10 2.5 16 5v4.5c0 3.8-2.6 6.6-6 8-3.4-1.4-6-4.2-6-8V5z" />
    <path d="m7.3 10 1.9 1.9 3.6-3.8" />
  </svg>
);
export const IconArrowRight = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M4 10h12m-4.5-4.5L16 10l-4.5 4.5" />
  </svg>
);
export const IconPlay = ({ className }: P) => (
  <svg {...base(className)}>
    <circle cx="10" cy="10" r="7.5" />
    <path d="m8.5 7 4.5 3-4.5 3z" fill="currentColor" />
  </svg>
);
export const IconSolana = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M5.5 5h11l-2 2.2h-11zM3.5 8.9h11l2 2.2h-11zM5.5 12.8h11l-2 2.2h-11z" />
  </svg>
);
export const IconMenu = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M3 6h14M3 10h14M3 14h14" />
  </svg>
);
export const IconClose = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="m5 5 10 10M15 5 5 15" />
  </svg>
);
export const IconExternal = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M11 3.5h5.5V9M16.5 3.5 9 11M14 12.5V16H4V6h3.5" />
  </svg>
);
export const IconCheck = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="m4.5 10.5 3.5 3.5 7.5-8" />
  </svg>
);
export const IconChevronDown = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="m5.5 8 4.5 4.5L14.5 8" />
  </svg>
);
export const IconSearch = ({ className }: P) => (
  <svg {...base(className)}>
    <circle cx="9" cy="9" r="5.5" />
    <path d="m13 13 4 4" />
  </svg>
);
export const IconLayers = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="m10 3 7 3.8-7 3.7-7-3.7zM3 10.2l7 3.8 7-3.8M3 13.6l7 3.9 7-3.9" />
  </svg>
);
