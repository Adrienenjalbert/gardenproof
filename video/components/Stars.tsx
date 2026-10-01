import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { EASE_OUT } from "../theme";

const STAR = "M12 2.6l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.4l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z";

/**
 * Five stars filled to `value` exactly (4.9 shows a 90%-filled fifth star) — never rounded up.
 * Stars pop in one after another from `start`.
 */
export const Stars: React.FC<{ value: number; size: number; color: string; start?: number; gap?: number; stagger?: number }> = ({
  value,
  size,
  color,
  start = 0,
  gap,
  stagger = 3,
}) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ display: "flex", gap: gap ?? size * 0.18 }}>
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.max(0, Math.min(1, value - i));
        const t = interpolate(frame - start - i * stagger, [0, 10], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: EASE_OUT,
        });
        const id = `clip-${i}-${Math.round(fill * 100)}`;
        return (
          <svg
            key={i}
            width={size}
            height={size}
            viewBox="0 0 24 24"
            style={{ opacity: t, transform: `scale(${0.7 + 0.3 * t})` }}
          >
            <defs>
              <clipPath id={id}>
                <rect x="0" y="0" width={24 * fill} height="24" />
              </clipPath>
            </defs>
            <path d={STAR} fill="none" stroke={color} strokeWidth={1.2} strokeLinejoin="round" />
            <path d={STAR} fill={color} clipPath={`url(#${id})`} />
          </svg>
        );
      })}
    </div>
  );
};
