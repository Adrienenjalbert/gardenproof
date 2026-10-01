/**
 * Remotion rendering: bundle once per process, one shared headless browser, media via a
 * loopback static server. Heavy modules are imported lazily so importing src/lib/video (Next
 * routes, unit tests) never loads webpack or Chromium.
 */
import fs from "node:fs";
import path from "node:path";
import type { HeadlessBrowser } from "@remotion/renderer";
import { COMPOSITION_IDS, type Template, type VideoProps } from "../../../video/schema";
import { timelineFor } from "../../../video/timing";
import { getMediaServer } from "./media-server";
import { resolvePropsMedia } from "./refs";

/** Remotion is chatty (e.g. cgroup memory warnings in containers); VIDEO_LOG_LEVEL=verbose to debug. */
const LOG_LEVEL = (process.env.VIDEO_LOG_LEVEL ?? "error") as "error" | "warn" | "info" | "verbose";

const g = globalThis as unknown as { __gpVideoBundle?: Promise<string>; __gpVideoBrowser?: Promise<HeadlessBrowser> };

/**
 * Chromium to use. Order: REMOTION_BROWSER_EXECUTABLE, then a Playwright headless shell under
 * /opt/pw-browsers (present in our sandboxes/CI), else null = let Remotion download its own.
 */
export function findBrowserExecutable(): string | null {
  if (process.env.REMOTION_BROWSER_EXECUTABLE) return process.env.REMOTION_BROWSER_EXECUTABLE;
  const root = "/opt/pw-browsers";
  if (!fs.existsSync(root)) return null;
  const dirs = fs.readdirSync(root).filter((d) => d.startsWith("chromium_headless_shell-")).sort().reverse();
  for (const d of dirs) {
    const exe = path.join(root, d, "chrome-linux", "headless_shell");
    if (fs.existsSync(exe)) return exe;
  }
  return null;
}

function getBundle(): Promise<string> {
  if (!g.__gpVideoBundle) {
    g.__gpVideoBundle = (async () => {
      const { bundle } = await import("@remotion/bundler");
      return bundle({
        entryPoint: path.join(process.cwd(), "video", "index.ts"),
        publicDir: path.join(process.cwd(), "public"),
      });
    })();
    g.__gpVideoBundle.catch(() => (g.__gpVideoBundle = undefined));
  }
  return g.__gpVideoBundle;
}

function getBrowser(): Promise<HeadlessBrowser> {
  if (!g.__gpVideoBrowser) {
    g.__gpVideoBrowser = (async () => {
      const { openBrowser } = await import("@remotion/renderer");
      return openBrowser("chrome", { browserExecutable: findBrowserExecutable(), chromeMode: "headless-shell", logLevel: LOG_LEVEL });
    })();
    g.__gpVideoBrowser.catch(() => (g.__gpVideoBrowser = undefined));
  }
  return g.__gpVideoBrowser;
}

/** Frame used for the poster thumbnail: the finished garden with its service line on screen. */
export function thumbnailFrame(template: Template, props: VideoProps): number {
  const tl = timelineFor(template, props);
  if (tl.kind === "reveal") return tl.service.from + 36;
  if (tl.kind === "proof") return tl.hero.from + 80;
  const after = tl.steps[tl.steps.length - 1]!;
  return after.from + 40;
}

export type RenderOutput = { durationSec: number; renderMs: number; bytes: number };

/** Render one composition to an mp4 (h264, CRF 20) and optionally a jpg poster. */
export async function renderToFiles(opts: {
  template: Template;
  props: VideoProps;
  mp4Path: string;
  thumbPath?: string;
  onProgress?: (p: number) => void;
}): Promise<RenderOutput> {
  const t0 = Date.now();
  const { renderMedia, renderStill, selectComposition } = await import("@remotion/renderer");
  const [serveUrl, browser, media] = await Promise.all([getBundle(), getBrowser(), getMediaServer()]);
  const inputProps = resolvePropsMedia(opts.props, media.baseUrl);
  const id = COMPOSITION_IDS[opts.template];
  const composition = await selectComposition({ serveUrl, id, inputProps, puppeteerInstance: browser, logLevel: LOG_LEVEL });
  fs.mkdirSync(path.dirname(opts.mp4Path), { recursive: true });
  await renderMedia({
    serveUrl,
    composition,
    inputProps,
    codec: "h264",
    crf: 20,
    pixelFormat: "yuv420p",
    // Tagged BT.709 limited range: what Meta / YouTube expect (untagged full-range JPEG frames can look washed out).
    colorSpace: "bt709",
    imageFormat: "jpeg",
    jpegQuality: 92,
    outputLocation: opts.mp4Path,
    puppeteerInstance: browser,
    logLevel: LOG_LEVEL,
    concurrency: process.env.VIDEO_RENDER_CONCURRENCY ?? null,
    overwrite: true,
    onProgress: ({ progress }) => opts.onProgress?.(progress),
  });
  if (opts.thumbPath) {
    await renderStill({
      serveUrl,
      composition,
      inputProps,
      frame: Math.min(composition.durationInFrames - 1, thumbnailFrame(opts.template, opts.props)),
      output: opts.thumbPath,
      imageFormat: "jpeg",
      jpegQuality: 85,
      puppeteerInstance: browser,
      logLevel: LOG_LEVEL,
      overwrite: true,
    });
  }
  return {
    durationSec: Math.round((composition.durationInFrames / composition.fps) * 10) / 10,
    renderMs: Date.now() - t0,
    bytes: fs.statSync(opts.mp4Path).size,
  };
}

/** Render single frames (design review without encoding a whole video). */
export async function renderFrames(opts: {
  template: Template;
  props: VideoProps;
  frames: number[];
  outPattern: (frame: number) => string;
}): Promise<void> {
  const { renderStill, selectComposition } = await import("@remotion/renderer");
  const [serveUrl, browser, media] = await Promise.all([getBundle(), getBrowser(), getMediaServer()]);
  const inputProps = resolvePropsMedia(opts.props, media.baseUrl);
  const composition = await selectComposition({ serveUrl, id: COMPOSITION_IDS[opts.template], inputProps, puppeteerInstance: browser, logLevel: LOG_LEVEL });
  for (const frame of opts.frames) {
    await renderStill({
      serveUrl,
      composition,
      inputProps,
      frame: Math.min(frame, composition.durationInFrames - 1),
      output: opts.outPattern(frame),
      imageFormat: "jpeg",
      jpegQuality: 85,
      puppeteerInstance: browser,
      logLevel: LOG_LEVEL,
      overwrite: true,
    });
  }
}

/** Close the shared browser + media server (scripts call this so the process can exit). */
export async function closeVideoRenderer(): Promise<void> {
  const b = g.__gpVideoBrowser;
  g.__gpVideoBrowser = undefined;
  if (b) await (await b).close({ silent: true }).catch(() => undefined);
  const m = globalThis as unknown as { __gpVideoMediaServer?: Promise<{ close: () => Promise<void> }> };
  const s = m.__gpVideoMediaServer;
  m.__gpVideoMediaServer = undefined;
  if (s) await (await s).close();
}
