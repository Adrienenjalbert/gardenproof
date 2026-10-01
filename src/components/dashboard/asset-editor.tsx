"use client";
/**
 * Inline asset editor: a structured form for the common text fields of each type, plus an "advanced JSON"
 * fallback. Both are validated against ASSET_CONTENT_SCHEMAS before sending; the server validates again
 * and bumps the version (optimistic concurrency via the version we opened).
 */
import { useMemo, useState, useTransition } from "react";
import type { AssetType } from "@/lib/domain";
import { saveAssetContentAction } from "@/lib/dashboard/actions";
import { FIELD_SPECS, fieldToText, setAt, textToField, validateAssetContent, type FieldSpec } from "@/lib/dashboard/asset-fields";
import { CharCounter } from "@/components/ui/char-counter";
import { Button, Input, Label, Select, Textarea, cx } from "@/components/ui/primitives";
import { toast } from "./toaster";

const keyOf = (s: FieldSpec) => s.path.join(".");

function applyTexts(base: unknown, specs: FieldSpec[], texts: Record<string, string>) {
  return specs.reduce((acc, s) => setAt(acc, s.path, textToField(s, texts[keyOf(s)] ?? "")), base);
}

function FieldControl({ spec, value, onChange }: { spec: FieldSpec; value: string; onChange: (v: string) => void }) {
  const id = `f-${keyOf(spec)}`;
  const limit = spec.maxWords ?? spec.max;
  const counter = limit && spec.kind !== "list" ? <CharCounter value={value} max={limit} words={!!spec.maxWords} /> : null;
  return (
    <div>
      <Label htmlFor={id} hint={counter ?? spec.hint}>
        {spec.label}
      </Label>
      {spec.kind === "text" && <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} />}
      {spec.kind === "textarea" && (
        <Textarea id={id} value={value} rows={Math.min(10, Math.max(2, Math.ceil(value.length / 90)))} onChange={(e) => onChange(e.target.value)} />
      )}
      {spec.kind === "select" && (
        <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          {spec.options?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      )}
      {spec.kind === "list" && (
        <>
          <Textarea
            id={id}
            value={value}
            rows={Math.max(3, value.split("\n").length + 1)}
            className="font-[inherit]"
            onChange={(e) => onChange(e.target.value)}
          />
          {limit && (
            <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
              {value
                .split("\n")
                .filter((l) => l.trim())
                .map((line, i) => (
                  <li key={i} className="text-[11px] text-muted">
                    #{i + 1} <CharCounter value={line.trim()} max={limit} words={!!spec.maxWords} />
                  </li>
                ))}
            </ul>
          )}
          {spec.hint && <p className="mt-1 text-xs text-muted">{spec.hint}</p>}
          {!spec.hint && <p className="mt-1 text-xs text-muted">One per line.</p>}
        </>
      )}
    </div>
  );
}

export function AssetEditor({
  assetId,
  type,
  version,
  content,
  onClose,
}: {
  assetId: string;
  type: AssetType;
  version: number;
  content: Record<string, unknown>;
  onClose: () => void;
}) {
  const specs = FIELD_SPECS[type];
  const initialTexts = useMemo(() => Object.fromEntries(specs.map((s) => [keyOf(s), fieldToText(s, content)])), [specs, content]);
  const [mode, setMode] = useState<"form" | "json">("form");
  const [base, setBase] = useState<unknown>(content);
  const [texts, setTexts] = useState<Record<string, string>>(initialTexts);
  const [json, setJson] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, start] = useTransition();

  /** Current content from whichever mode is active; null + errors when JSON doesn't parse. */
  function current(): unknown | null {
    if (mode === "form") return applyTexts(base, specs, texts);
    try {
      return JSON.parse(json);
    } catch (e) {
      setErrors([`JSON: ${(e as Error).message}`]);
      return null;
    }
  }

  function switchTo(next: "form" | "json") {
    if (next === mode) return;
    const c = current();
    if (c === null) return;
    setErrors([]);
    if (next === "json") setJson(JSON.stringify(c, null, 2));
    else {
      setBase(c);
      setTexts(Object.fromEntries(specs.map((s) => [keyOf(s), fieldToText(s, c)])));
    }
    setMode(next);
  }

  function save() {
    const c = current();
    if (c === null) return;
    const v = validateAssetContent(type, c);
    if (!v.ok) {
      setErrors(v.errors);
      return;
    }
    setErrors([]);
    start(async () => {
      const r = await saveAssetContentAction({ assetId, version, contentJson: JSON.stringify(v.content) });
      toast(r);
      if (r.ok) onClose();
      else setErrors([r.error]);
    });
  }

  return (
    <div className="rounded-2xl bg-[#f8f7f1] p-4 ring-1 ring-line sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Editing version {version}</p>
        <div role="tablist" className="inline-flex rounded-lg bg-white p-0.5 ring-1 ring-line">
          {(["form", "json"] as const).map((m) => (
            <button
              key={m}
              role="tab"
              type="button"
              aria-selected={mode === m}
              onClick={() => switchTo(m)}
              className={cx(
                "rounded-md px-3 py-1 text-xs font-medium",
                mode === m ? "bg-olive text-white" : "text-muted hover:text-foreground",
              )}
            >
              {m === "form" ? "Fields" : "Advanced JSON"}
            </button>
          ))}
        </div>
      </div>

      {mode === "form" ? (
        <div className="grid gap-4">
          {specs.map((s) => (
            <FieldControl
              key={keyOf(s)}
              spec={s}
              value={texts[keyOf(s)] ?? ""}
              onChange={(v) => setTexts((t) => ({ ...t, [keyOf(s)]: v }))}
            />
          ))}
        </div>
      ) : (
        <Textarea
          aria-label="Asset content JSON"
          value={json}
          spellCheck={false}
          rows={Math.min(28, json.split("\n").length + 1)}
          onChange={(e) => setJson(e.target.value)}
          className="font-mono text-xs leading-5"
        />
      )}

      {errors.length > 0 && (
        <ul role="alert" className="mt-4 space-y-1 rounded-xl bg-red-50 px-3.5 py-2.5 text-[13px] text-red-800 ring-1 ring-red-200">
          {errors.slice(0, 6).map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
        <p className="mr-auto text-xs text-muted">Saving creates version {version + 1} and sends it back to review.</p>
        <Button variant="ghost" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button variant="primary" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
