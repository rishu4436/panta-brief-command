/** Flat terminal / probability mark — YES emerald · NO rose · cyan ticks. No gradient blob. */
export function BrandMark({
  className = "h-6 w-6",
  title = "Brief Command",
}: {
  className?: string;
  title?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      {/* Terminal chassis */}
      <rect
        x="1"
        y="1"
        width="30"
        height="30"
        rx="7"
        fill="#0e0e10"
        stroke="#2a2a2e"
        strokeWidth="1.5"
      />
      {/* Window chrome dots */}
      <circle cx="8" cy="8" r="1.4" fill="#3f3f46" />
      <circle cx="12.5" cy="8" r="1.4" fill="#3f3f46" />
      <circle cx="17" cy="8" r="1.4" fill="#3f3f46" />
      {/* Probability / tick bars — YES emerald · NO rose · cyan accent */}
      <rect x="7" y="13" width="11" height="2.75" rx="1" fill="#10b981" />
      <rect x="19" y="13" width="6" height="2.75" rx="1" fill="#f43f5e" />
      <rect x="7" y="18" width="7" height="2.75" rx="1" fill="#10b981" />
      <rect x="15" y="18" width="10" height="2.75" rx="1" fill="#f43f5e" />
      <rect x="7" y="23" width="14" height="2.75" rx="1" fill="#22d3ee" />
      {/* Terminal caret */}
      <path
        d="M23.5 23 L26.5 24.4 L23.5 25.8"
        stroke="#22d3ee"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
