/**
 * Owner-app building blocks (server-safe): page frame, large titles, inset grouped lists, buttons, thumbnails.
 * One visual language everywhere: grouped background, white rounded cards, hairline separators, one accent.
 */
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { OIcon, type OwnerIconName } from "./icons";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** The page column: comfortable on a phone, centred and airy on desktop. */
export function Page({
  children,
  className,
  wide = false,
}: {
  children: ReactNode;
  className?: string;
  wide?: boolean;
}) {
  return (
    <div
      className={cx(
        "pb-tabbar mx-auto w-full px-4 pt-3 sm:px-6 lg:px-10 lg:pt-12",
        wide ? "max-w-[980px]" : "max-w-[680px]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function LargeTitle({
  title,
  subtitle,
  action,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="mb-6 flex items-end justify-between gap-4 pt-10 lg:pt-0 [div+&]:pt-1">
      <div className="min-w-0">
        {subtitle && <p className="mb-1 text-[13px] font-semibold tracking-wide text-(--ink2) uppercase">{subtitle}</p>}
        <h1 className="font-title text-[34px] leading-[1.08] font-bold text-(--ink)">{title}</h1>
      </div>
      {action}
    </header>
  );
}

export function SectionTitle({
  children,
  action,
  className,
}: {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("mb-2.5 flex items-baseline justify-between px-1", className)}>
      <h2 className="text-[20px] leading-tight font-semibold tracking-[-0.01em] text-(--ink)">{children}</h2>
      {action}
    </div>
  );
}

/** Small grey caption above an inset group (iOS style). */
export function GroupLabel({ children }: { children: ReactNode }) {
  return <p className="mb-1.5 px-4 text-[13px] text-(--ink2)">{children}</p>;
}

export function Group({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("overflow-hidden rounded-[20px] bg-(--card) shadow-(--shadow)", className)}>{children}</div>
  );
}

/** Hairline between rows, inset to align with the text (not the icon). */
export function RowDivider({ inset = 16 }: { inset?: number }) {
  return <div className="h-px bg-(--sep)" style={{ marginLeft: inset }} />;
}

type RowProps = {
  href?: string;
  icon?: OwnerIconName;
  iconTint?: string;
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  chevron?: boolean;
  external?: boolean;
};

export function Row({
  href,
  icon,
  iconTint,
  leading,
  title,
  subtitle,
  trailing,
  chevron = !!href,
  external,
}: RowProps) {
  const inner = (
    <div className="flex min-h-[52px] items-center gap-3.5 px-4 py-2.5">
      {leading ??
        (icon && (
          <span
            className="grid size-[30px] shrink-0 place-items-center rounded-[8px] text-white"
            style={{ background: iconTint ?? "var(--accent)" }}
          >
            <OIcon name={icon} size={18} strokeWidth={1.9} />
          </span>
        ))}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[17px] leading-snug text-(--ink)">{title}</div>
        {subtitle && <div className="mt-0.5 truncate text-[14px] leading-snug text-(--ink2)">{subtitle}</div>}
      </div>
      {trailing && <div className="shrink-0 text-[15px] text-(--ink2)">{trailing}</div>}
      {chevron && (
        <OIcon
          name={external ? "external" : "chevronRight"}
          size={external ? 16 : 17}
          className="shrink-0 text-(--ink3)"
        />
      )}
    </div>
  );
  if (!href) return inner;
  if (external || /^(https?:|tel:|mailto:)/.test(href)) {
    return (
      <a
        href={href}
        target={external ? "_blank" : undefined}
        rel="noreferrer"
        className="block transition-colors active:bg-(--fill2)"
      >
        {inner}
      </a>
    );
  }
  return (
    <Link href={href} className="block transition-colors active:bg-(--fill2) lg:hover:bg-(--fill2)">
      {inner}
    </Link>
  );
}

export type ButtonVariant = "primary" | "tinted" | "plain" | "gray" | "danger";

export function buttonClass(variant: ButtonVariant = "primary", size: "md" | "lg" | "sm" = "md", full = false): string {
  return cx(
    "press inline-flex select-none items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap disabled:opacity-40 disabled:pointer-events-none",
    size === "lg" ? "h-[52px] px-6 text-[17px]" : size === "sm" ? "h-9 px-4 text-[15px]" : "h-11 px-5 text-[16px]",
    variant === "primary" && "bg-(--accent) text-(--accent-ink)",
    variant === "tinted" && "bg-(--accent-soft) text-(--accent)",
    variant === "gray" && "bg-(--fill) text-(--ink)",
    variant === "plain" && "px-2 text-(--accent)",
    variant === "danger" && "bg-(--red-soft) text-(--red)",
    full && "w-full",
  );
}

export function ButtonLink({
  variant,
  size,
  full,
  className,
  ...rest
}: ComponentProps<typeof Link> & {
  variant?: ButtonVariant;
  size?: "md" | "lg" | "sm";
  full?: boolean;
}) {
  return <Link className={cx(buttonClass(variant, size, full), className)} {...rest} />;
}

/** Photo, or a soft monogram when there isn't one. */
export function Thumb({
  src,
  label,
  size = 52,
  radius = 12,
  className,
}: {
  src: string | null;
  label: string;
  size?: number;
  radius?: number;
  className?: string;
}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        className={cx("shrink-0 object-cover", className)}
        style={{ width: size, height: size, borderRadius: radius }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cx("grid shrink-0 place-items-center bg-(--accent-soft) font-semibold text-(--accent)", className)}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        fontSize: Math.round(size * 0.36),
      }}
    >
      {label.slice(0, 2)}
    </span>
  );
}

/** Status pill. `solid` sits on photos: a frosted white chip with coloured text. */
export function Pill({
  children,
  tone = "gray",
  solid = false,
}: {
  children: ReactNode;
  tone?: "gray" | "accent" | "amber" | "green" | "red";
  solid?: boolean;
}) {
  return (
    <span
      className={cx(
        "inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-[12.5px] font-semibold whitespace-nowrap",
        solid && "!bg-white/90 shadow-sm backdrop-blur-md",
        tone === "gray" && "bg-(--fill) text-(--ink2)",
        tone === "accent" && "bg-(--accent-soft) text-(--accent)",
        tone === "amber" && "bg-(--amber-soft) text-(--amber)",
        tone === "green" && "bg-(--green-soft) text-(--green)",
        tone === "red" && "bg-(--red-soft) text-(--red)",
      )}
    >
      {children}
    </span>
  );
}

export function Empty({
  icon,
  title,
  children,
  action,
}: {
  icon: OwnerIconName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="anim-rise flex flex-col items-center px-6 py-14 text-center">
      <span className="mb-4 grid size-16 place-items-center rounded-full bg-(--accent-soft) text-(--accent)">
        <OIcon name={icon} size={30} strokeWidth={1.5} />
      </span>
      <p className="text-[19px] font-semibold text-(--ink)">{title}</p>
      {children && <p className="mt-1.5 max-w-[30ch] text-[15px] leading-relaxed text-(--ink2)">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="press -ml-1.5 inline-flex h-10 items-center gap-0.5 pr-3 text-[17px] text-(--accent)">
      <OIcon name="chevronLeft" size={24} strokeWidth={2} />
      {label}
    </Link>
  );
}
