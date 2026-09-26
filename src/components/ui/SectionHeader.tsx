import type { ReactNode } from "react";

export function SectionHeader({
  eyebrow,
  title,
  description,
  align = "left",
  id,
  tone = "cyan",
  action,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  align?: "left" | "center";
  id?: string;
  tone?: "cyan" | "ai";
  action?: ReactNode;
}) {
  const center = align === "center";
  return (
    <div className={`flex flex-wrap items-end justify-between gap-4 ${center ? "flex-col items-center text-center" : ""}`}>
      <div className={center ? "mx-auto max-w-2xl" : "max-w-2xl"}>
        {eyebrow ? <p className={`eyebrow ${tone === "ai" ? "eyebrow--ai" : ""}`}>{eyebrow}</p> : null}
        <h2 id={id} className="h-section mt-3">
          {title}
        </h2>
        {description ? <p className="text-lede mt-3">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
