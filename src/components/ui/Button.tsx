import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost";
type Size = "sm" | "md" | "lg";

type Common = { variant?: Variant; size?: Size; className?: string; children: ReactNode };
type AsButton = Common & ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined };
type AsLink = Common & AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; external?: boolean };

function cls(variant: Variant, size: Size, extra = "") {
  const s = size === "lg" ? "btn-lg" : size === "sm" ? "btn-sm" : "";
  return `btn btn-${variant} ${s} ${extra}`.trim();
}

/** Base button: renders a Next <Link> when `href` is given, else a <button>. */
export function Button(props: AsButton | AsLink) {
  if (props.href !== undefined) {
    const { href, external, variant = "secondary", size = "md", className = "", children, ...rest } = props as AsLink;
    const c = cls(variant, size, className);
    if (external) {
      return (
        <a href={href} target="_blank" rel="noreferrer" className={c} {...rest}>
          {children}
        </a>
      );
    }
    return (
      <Link href={href} className={c} {...rest}>
        {children}
      </Link>
    );
  }
  const { variant = "secondary", size = "md", className = "", children, type = "button", ...rest } = props as AsButton;
  return (
    <button type={type} className={cls(variant, size, className)} {...rest}>
      {children}
    </button>
  );
}

export function PrimaryButton(props: AsButton | AsLink) {
  return <Button {...props} variant="primary" />;
}

export function SecondaryButton(props: AsButton | AsLink) {
  return <Button {...props} variant="secondary" />;
}

export function GhostButton(props: AsButton | AsLink) {
  return <Button {...props} variant="ghost" />;
}
