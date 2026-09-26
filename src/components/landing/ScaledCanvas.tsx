"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * Renders real desk components at their true design width, then scales the
 * whole canvas to the available width with CSS `zoom` (layout-aware, so text
 * and borders stay crisp). The outer box keeps the aspect ratio from the first
 * paint, so there is no layout shift while the scale is measured.
 */
export function ScaledCanvas({
  width,
  height,
  children,
  className = "",
}: {
  width: number;
  height: number;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setZoom(el.clientWidth / width);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);

  return (
    <div ref={ref} className={`relative overflow-hidden ${className}`} style={{ aspectRatio: `${width} / ${height}` }}>
      <div
        className={`absolute left-0 top-0 origin-top-left transition-opacity duration-300 ${zoom == null ? "opacity-0" : "opacity-100"}`}
        style={{ width, height, zoom: zoom ?? 1 }}
      >
        {children}
      </div>
    </div>
  );
}
