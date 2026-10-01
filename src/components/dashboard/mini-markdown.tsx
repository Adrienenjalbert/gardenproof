/**
 * Tiny, safe Markdown renderer for previews (headings, lists, paragraphs, **bold**, *italic*).
 * Renders React elements only — no HTML injection — which is all a draft excerpt needs.
 */
import type { ReactNode } from "react";

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) return <em key={i}>{part.slice(1, -1)}</em>;
    return part;
  });
}

export function MiniMarkdown({ source }: { source: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) {
      blocks.push(
        <ul key={`l${blocks.length}`} className="my-2 list-disc space-y-1 pl-5">
          {list.map((li, i) => (
            <li key={i}>{inline(li)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };
  for (const raw of source.split("\n")) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      list.push(bullet[1]);
      continue;
    }
    flush();
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      blocks.push(
        <p key={blocks.length} className="mt-4 mb-1 font-display text-[15px] text-foreground first:mt-0">
          {inline(h[2])}
        </p>,
      );
    } else if (line.trim()) {
      blocks.push(
        <p key={blocks.length} className="my-2">
          {inline(line)}
        </p>,
      );
    }
  }
  flush();
  return <div className="text-sm leading-relaxed text-foreground/85">{blocks}</div>;
}
