/** A trade badge: its official image (as shown on the business's own site) with a small confirmed / unconfirmed mark. */
import { OIcon } from "./icons";
import { cx } from "./ui";

export function BadgeLogo({
  imageKey,
  imageUrl,
  verified,
  size = 40,
}: {
  imageKey: string | null;
  imageUrl: string | null;
  verified: boolean;
  size?: number;
}) {
  const src = imageKey ? `/api/media/${imageKey}` : imageUrl;
  return (
    <span className="relative shrink-0" style={{ width: size, height: size }}>
      {src ? (
        <span className="grid h-full w-full place-items-center overflow-hidden rounded-[10px] bg-white p-1 ring-1 ring-black/5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt=""
            className={cx("max-h-full max-w-full object-contain", !verified && "opacity-45 grayscale")}
          />
        </span>
      ) : (
        <span
          className={cx(
            "grid h-full w-full place-items-center rounded-full",
            verified ? "bg-(--green-soft) text-(--green)" : "bg-(--amber-soft) text-(--amber)",
          )}
        >
          <OIcon name={verified ? "seal" : "question"} size={size * 0.5} />
        </span>
      )}
      {src && (
        <span
          className={cx(
            "absolute -right-1 -bottom-1 grid size-[18px] place-items-center rounded-full text-white ring-2 ring-(--card)",
            verified ? "bg-(--green)" : "bg-(--amber)",
          )}
        >
          <OIcon name={verified ? "check" : "question"} size={11} strokeWidth={3} />
        </span>
      )}
    </span>
  );
}
