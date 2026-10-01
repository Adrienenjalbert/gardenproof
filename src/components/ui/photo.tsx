import type { ComponentProps } from "react";
import { Icon } from "./icons";
import { cx } from "./primitives";

/**
 * Plain <img> for media served by /api/media (already sized derivatives; next/image optimisation
 * would need remote-pattern config and adds nothing for a private dashboard).
 */
export function Photo({ src, alt, className, ...rest }: Omit<ComponentProps<"img">, "src"> & { src: string | null }) {
  if (!src) {
    return (
      <div className={cx("grid place-items-center bg-olive-50 text-olive/50", className)} role="img" aria-label={alt}>
        <Icon name="image" size={28} />
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} loading="lazy" decoding="async" className={cx("object-cover", className)} {...rest} />;
}
