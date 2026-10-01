/**
 * Export folders in storage: `exports/<jobId>/<YYYY-MM-DD>/<kind>/` holding hand-off files plus a manifest.
 * Re-publishing on the same day overwrites the folder (idempotent). Served by /api/export/[assetId].
 */
import { getObject, putObject } from "@/lib/storage";

export const EXPORT_KINDS = ["ads", "social", "gbp"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export type ExportFile = { name: string; data: Buffer | Uint8Array | string; contentType: string };

export type ExportManifest = {
  version: 1;
  kind: ExportKind;
  title: string;
  jobId: string;
  assetIds: string[];
  createdAt: string;
  files: { name: string; bytes: number; contentType: string }[];
  warnings: string[];
  notes: string[];
};

const SAFE_NAME = /^[a-z0-9][a-z0-9._-]{0,120}$/i;
export const isSafeExportFileName = (name: string) => SAFE_NAME.test(name) && !name.includes("..");

export function exportFolder(jobId: string, kind: ExportKind, date = new Date()): string {
  const day = date.toISOString().slice(0, 10);
  return `exports/${jobId.replace(/[^a-z0-9_-]/gi, "_")}/${day}/${kind}`;
}

export async function writeExport(
  folder: string,
  files: ExportFile[],
  info: Omit<ExportManifest, "version" | "files" | "createdAt">,
): Promise<ExportManifest> {
  const listed: ExportManifest["files"] = [];
  for (const file of files) {
    if (!isSafeExportFileName(file.name)) throw new Error(`Unsafe export file name: ${file.name}`);
    const data = typeof file.data === "string" ? Buffer.from(file.data, "utf8") : file.data;
    await putObject(`${folder}/${file.name}`, data);
    listed.push({ name: file.name, bytes: data.byteLength, contentType: file.contentType });
  }
  const manifest: ExportManifest = { version: 1, ...info, files: listed, createdAt: new Date().toISOString() };
  await putObject(`${folder}/manifest.json`, Buffer.from(JSON.stringify(manifest, null, 2)));
  return manifest;
}

export async function readManifest(folder: string): Promise<ExportManifest | null> {
  try {
    return JSON.parse((await getObject(`${folder}/manifest.json`)).toString("utf8")) as ExportManifest;
  } catch {
    return null;
  }
}

/** URL of the export index for an asset (relative; the dashboard and preview are same-origin). */
export const exportUrl = (assetId: string) => `/api/export/${encodeURIComponent(assetId)}`;
