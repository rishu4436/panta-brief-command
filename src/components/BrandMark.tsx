import { useId } from "react";

/**
 * Brief Command mark: a four-point signal star with one elongated
 * north-east ray — a directional "command" vector over a signal crosshair.
 * Geometric, not a coin. Cyan → blue → violet.
 */
export function BrandMark({ className = "h-7 w-7", title = "Brief Command" }: { className?: string; title?: string }) {
  const gid = useId().replace(/:/g, "");
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label={title}>
      <title>{title}</title>
      <defs>
        <linearGradient id={`bm-${gid}`} x1="4" y1="28" x2="28" y2="4" gradientUnits="userSpaceOnUse">
          <stop stopColor="#12D6F5" />
          <stop offset="0.55" stopColor="#3478F6" />
          <stop offset="1" stopColor="#8B5CF6" />
        </linearGradient>
      </defs>
      {/* Four-point signal star */}
      <path d="M16 3 18.4 13.6 29 16 18.4 18.4 16 29 13.6 18.4 3 16 13.6 13.6Z" fill={`url(#bm-${gid})`} />
      {/* Directional command ray (north-east) */}
      <path d="M18.6 13.4 26.2 5.8" stroke={`url(#bm-${gid})`} strokeWidth="2.2" strokeLinecap="round" />
      <path d="M21.6 5.2h5.2v5.2" stroke="#12D6F5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="16" cy="16" r="2" fill="#050914" />
    </svg>
  );
}
