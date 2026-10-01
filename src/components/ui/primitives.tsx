/**
 * GardenProof UI kit: small, dependency-free primitives in the olive brand.
 * Server-component safe (no hooks); interactive pieces live in their own "use client" files.
 */
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { Icon, type IconName } from "./icons";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
export type ButtonSize = "sm" | "md";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-olive text-white shadow-sm hover:bg-olive-dark disabled:bg-olive/50",
  secondary: "bg-white text-foreground ring-1 ring-inset ring-line shadow-xs hover:bg-olive-50 hover:ring-olive-100",
  ghost: "text-muted hover:text-foreground hover:bg-olive-50",
  subtle: "bg-olive-50 text-olive-dark hover:bg-olive-100",
  danger: "bg-white text-red-700 ring-1 ring-inset ring-red-200 hover:bg-red-50",
};
const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-lg",
  md: "h-10 px-4 text-sm gap-2 rounded-xl",
};

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", extra?: string) {
  return cx(
    "inline-flex items-center justify-center font-medium whitespace-nowrap transition-colors select-none",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive disabled:cursor-not-allowed disabled:opacity-60",
    VARIANTS[variant],
    SIZES[size],
    extra,
  );
}

type BtnOwn = { variant?: ButtonVariant; size?: ButtonSize; icon?: IconName; iconRight?: IconName };

export function Button({ variant, size, icon, iconRight, className, children, ...rest }: BtnOwn & ComponentProps<"button">) {
  return (
    <button type="button" className={buttonClass(variant, size, className)} {...rest}>
      {icon && <Icon name={icon} size={size === "sm" ? 15 : 16} />}
      {children}
      {iconRight && <Icon name={iconRight} size={size === "sm" ? 15 : 16} />}
    </button>
  );
}

export function ButtonLink({
  variant,
  size,
  icon,
  iconRight,
  className,
  children,
  external,
  ...rest
}: BtnOwn & ComponentProps<typeof Link> & { external?: boolean }) {
  return (
    <Link
      className={buttonClass(variant, size, className)}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === "sm" ? 15 : 16} />}
      {children}
      {iconRight && <Icon name={iconRight} size={size === "sm" ? 15 : 16} />}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

export type Tone = "neutral" | "olive" | "leaf" | "amber" | "red" | "blue" | "dark";

const TONES: Record<Tone, string> = {
  neutral: "bg-stone-100 text-stone-700 ring-stone-200",
  olive: "bg-olive-50 text-olive-dark ring-olive-100",
  leaf: "bg-lime-50 text-lime-800 ring-lime-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  blue: "bg-sky-50 text-sky-800 ring-sky-200",
  dark: "bg-olive-dark text-white ring-olive-dark",
};

export function Badge({
  tone = "neutral",
  icon,
  children,
  className,
  title,
}: {
  tone?: Tone;
  icon?: IconName;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium leading-5 ring-1 ring-inset whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {icon && <Icon name={icon} size={12} />}
      {children}
    </span>
  );
}

/** Small dot + label used for statuses. */
export function Dot({ tone }: { tone: Tone }) {
  const bg: Record<Tone, string> = {
    neutral: "bg-stone-400",
    olive: "bg-olive",
    leaf: "bg-lime-500",
    amber: "bg-amber-500",
    red: "bg-red-500",
    blue: "bg-sky-500",
    dark: "bg-olive-dark",
  };
  return <span aria-hidden className={cx("inline-block size-1.5 rounded-full", bg[tone])} />;
}

// ---------------------------------------------------------------------------
// Card / Section
// ---------------------------------------------------------------------------

export function Card({ className, children, ...rest }: ComponentProps<"div">) {
  return (
    <div className={cx("rounded-2xl bg-white ring-1 ring-line shadow-[0_1px_2px_rgba(31,33,23,0.04)]", className)} {...rest}>
      {children}
    </div>
  );
}

export function SectionHeader({
  title,
  description,
  action,
  as: As = "h2",
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  as?: "h1" | "h2" | "h3";
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <As className={cx("font-display text-foreground", As === "h1" ? "text-2xl sm:text-[28px]" : "text-lg")}>{title}</As>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ eyebrow, title, description, actions }: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 max-w-3xl">
        {eyebrow && <p className="mb-2 text-xs font-medium tracking-[0.12em] text-muted uppercase">{eyebrow}</p>}
        <h1 className="font-display text-[26px] leading-tight text-foreground sm:text-[32px]">{title}</h1>
        {description && <p className="mt-2 text-[15px] leading-relaxed text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

// ---------------------------------------------------------------------------
// Tabs (link-based: server rendered, shareable URLs)
// ---------------------------------------------------------------------------

export function Tabs({
  items,
  active,
}: {
  items: { key: string; label: string; href: string; count?: number }[];
  active: string;
}) {
  return (
    <nav aria-label="Sections" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1 border-b border-line">
        {items.map((t) => {
          const on = t.key === active;
          return (
            <li key={t.key}>
              <Link
                href={t.href}
                scroll={false}
                aria-current={on ? "page" : undefined}
                className={cx(
                  "relative -mb-px inline-flex h-11 items-center gap-2 px-3 text-sm font-medium transition-colors",
                  on ? "text-foreground" : "text-muted hover:text-foreground",
                )}
              >
                {t.label}
                {t.count !== undefined && (
                  <span
                    className={cx(
                      "rounded-full px-1.5 text-[11px] leading-[18px] tabular-nums",
                      on ? "bg-olive text-white" : "bg-olive-50 text-muted",
                    )}
                  >
                    {t.count}
                  </span>
                )}
                {on && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-olive" />}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

export function EmptyState({
  icon = "grid",
  title,
  children,
  action,
  compact,
}: {
  icon?: IconName;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={cx(
        "flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-white/50 text-center",
        compact ? "px-4 py-8" : "px-6 py-14",
      )}
    >
      <span className="mb-3 grid size-10 place-items-center rounded-full bg-olive-50 text-olive">
        <Icon name={icon} size={18} />
      </span>
      <p className="font-medium text-foreground">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------

const fieldBase =
  "w-full rounded-xl bg-white px-3 text-sm text-foreground ring-1 ring-inset ring-line placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-olive/60 transition-shadow";

export function Input({ className, ...rest }: ComponentProps<"input">) {
  return <input className={cx(fieldBase, "h-10", className)} {...rest} />;
}

export function Textarea({ className, ...rest }: ComponentProps<"textarea">) {
  return <textarea className={cx(fieldBase, "py-2.5 leading-relaxed", className)} {...rest} />;
}

export function Select({ className, children, ...rest }: ComponentProps<"select">) {
  return (
    <select className={cx(fieldBase, "h-10 appearance-none bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-9", className)}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236b6e5c' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
      }}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Label({ children, htmlFor, hint }: { children: ReactNode; htmlFor?: string; hint?: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px] font-medium text-foreground">
      <span>{children}</span>
      {hint && <span className="text-xs font-normal text-muted">{hint}</span>}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

/** Definition row used in fact lists. */
export function Fact({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex gap-4 py-2.5 text-sm">
      <dt className="w-32 shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 flex-1 text-foreground">{children}</dd>
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-grid min-w-5 place-items-center rounded-md bg-white px-1 font-sans text-[11px] leading-5 text-muted ring-1 ring-line shadow-[0_1px_0_var(--line)]">
      {children}
    </kbd>
  );
}
