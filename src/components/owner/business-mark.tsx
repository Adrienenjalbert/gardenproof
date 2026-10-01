/** The business's logo on a white tile (logos are made for white), or its initial in the brand colour. */
import type { Brand } from "@/lib/owner/tenant";
import { cx } from "./ui";

export function BusinessMark({
  brand,
  size = 36,
  className,
}: {
  brand: Pick<Brand, "name" | "logoUrl">;
  size?: number;
  className?: string;
}) {
  if (brand.logoUrl) {
    return (
      <span
        className={cx(
          "grid shrink-0 place-items-center overflow-hidden rounded-[10px] bg-white ring-1 ring-black/5",
          className,
        )}
        style={{ width: size, height: size }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={brand.logoUrl} alt="" className="h-full w-full object-contain p-[3px]" />
      </span>
    );
  }
  return (
    <span
      className={cx(
        "grid shrink-0 place-items-center rounded-[10px] bg-(--accent) font-semibold text-(--accent-ink)",
        className,
      )}
      style={{ width: size, height: size, fontSize: size * 0.45 }}
    >
      {brand.name.slice(0, 1)}
    </span>
  );
}
