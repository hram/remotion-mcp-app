import { bundle } from "@remotion/bundler";
import {
  openBrowser,
  selectComposition,
  renderStill,
  renderMedia,
} from "@remotion/renderer";
import { mkdtemp, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp, { type OverlayOptions } from "sharp";
import { getSessionProject, type SessionProjectState } from "../utils.js";
import { RUNTIME_BUNDLE_GLOBAL, RUNTIME_PACKAGE_GLOBAL } from "../types.js";
import {
  resolvePreviewOptions,
  exportVideoSchema,
  type InspectFramesOptions,
  type ExportVideoOptions,
} from "./options.js";

const packages = [
  "react",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "remotion",
];
let browser: ReturnType<typeof openBrowser> | undefined;
function getBrowser() {
  return (browser ??= openBrowser("chrome", {
    browserExecutable: process.env.REMOTION_BROWSER_EXECUTABLE || undefined,
    chromiumOptions: { gl: "swangle" },
  }).catch((error) => {
    browser = undefined;
    throw error;
  }));
}

type Preparation = { directory: string; serveUrl: string };
const directories = new Set<string>();
// Bound temporary bundle storage; active renders hold a lease on their bundle.
const cache = new Map<
  SessionProjectState,
  { promise: Promise<Preparation>; users: number }
>();
async function prune() {
  for (const [project, entry] of cache) {
    if (cache.size <= 16) break;
    if (entry.users) continue;
    cache.delete(project);
    const prepared = await entry.promise.catch(() => null);
    if (prepared) {
      await rm(prepared.directory, { recursive: true, force: true });
      directories.delete(prepared.directory);
    }
  }
}

async function prepare(project: SessionProjectState): Promise<Preparation> {
  if (project.compileError)
    throw new Error(`Project compilation error: ${project.compileError}`);
  if (!project.bundle)
    throw new Error("Project has no compiled bundle. Call create_video first.");
  const directory = await mkdtemp(path.join(tmpdir(), "remotion-mcp-bundle-"));
  directories.add(directory);
  try {
    const entryPoint = path.join(directory, "entry.jsx");
    const source = [
      ...packages.map(
        (name, i) => `import * as package${i} from ${JSON.stringify(name)};`,
      ),
      'import {Composition, registerRoot} from "remotion";',
      `globalThis.${RUNTIME_PACKAGE_GLOBAL} = {${packages.map((name, i) => `${JSON.stringify(name)}: package${i}`).join(",")}};`,
      project.bundle,
      `const video = ${RUNTIME_BUNDLE_GLOBAL};`,
      'if (typeof video.default !== "function") throw new Error("Entry module must export a default React component.");',
      `const meta = ${JSON.stringify({ id: project.compositionId, width: project.width, height: project.height, fps: project.fps, durationInFrames: project.durationInFrames, defaultProps: project.defaultProps })};`,
      `registerRoot(() => package0.createElement(Composition, {...meta, component: video.default, calculateMetadata: video.calculateMetadata}));`,
      project.css ? 'import "./project.css";' : "",
    ].join("\n");
    await writeFile(entryPoint, source);
    if (project.css)
      await writeFile(path.join(directory, "project.css"), project.css);
    const serveUrl = await bundle({
      entryPoint,
      rootDir: process.cwd(),
      outDir: path.join(directory, "bundle"),
      enableCaching: false,
      webpackOverride: (config) => ({
        ...config,
        resolve: {
          ...config.resolve,
          modules: [
            path.join(process.cwd(), "node_modules"),
            ...(config.resolve?.modules ?? ["node_modules"]),
          ],
        },
      }),
    });
    return { directory, serveUrl };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    directories.delete(directory);
    throw error;
  }
}

async function withProject<T>(
  sessionId: string,
  action: (config: {
    project: SessionProjectState;
    serveUrl: string;
    composition: Awaited<ReturnType<typeof selectComposition>>;
    puppeteerInstance: Awaited<ReturnType<typeof openBrowser>>;
  }) => Promise<T>,
): Promise<T> {
  const project = getSessionProject(sessionId);
  if (!project)
    throw new Error(
      "No video project exists in this session. Call create_video first.",
    );
  let entry = cache.get(project);
  if (!entry) {
    const promise = prepare(project);
    entry = { promise, users: 0 };
    cache.set(project, entry);
  }
  entry.users++;
  try {
    const { serveUrl } = await entry.promise;
    const puppeteerInstance = await getBrowser();
    const composition = await selectComposition({
      serveUrl,
      id: project.compositionId,
      inputProps: project.inputProps,
      puppeteerInstance,
    });
    return await action({ project, serveUrl, composition, puppeteerInstance });
  } catch (error) {
    // Failed preparations may be retried (e.g. browser installation/network failure).
    if (
      await entry.promise.then(
        () => false,
        () => true,
      )
    )
      cache.delete(project);
    throw error;
  } finally {
    entry.users--;
    await prune();
  }
}

export function selectFrames(
  duration: number,
  frames?: number[],
  count = 6,
): number[] {
  if (!Number.isInteger(count) || count < 1 || count > 24)
    throw new Error("count must be an integer in 1..24.");
  if (frames) {
    if (!frames.length || frames.length > 24)
      throw new Error("frames must contain 1..24 frame numbers.");
    for (const frame of frames)
      if (!Number.isInteger(frame) || frame < 0 || frame >= duration)
        throw new Error(
          `Frame ${frame} is outside valid range 0..${duration - 1}.`,
        );
    return frames;
  }
  const size = Math.min(count, duration);
  return Array.from({ length: size }, (_, i) =>
    size === 1 ? 0 : Math.round((i * (duration - 1)) / (size - 1)),
  );
}

function metadata(composition: Awaited<ReturnType<typeof selectComposition>>) {
  const { width, height, fps, durationInFrames } = composition;
  return { width, height, fps, durationInFrames };
}

export async function inspectFrames(
  sessionId: string,
  options: InspectFramesOptions = {},
) {
  return withProject(
    sessionId,
    async ({ serveUrl, composition, puppeteerInstance, project }) => {
      const frames = selectFrames(
        composition.durationInFrames,
        options.frames,
        options.count,
      );
      const preview = resolvePreviewOptions(
        composition.width,
        composition.height,
        options,
      );
      const directory = await mkdtemp(
        path.join(tmpdir(), "remotion-mcp-frames-"),
      );
      try {
        let tileWidth = 0;
        let tileHeight = 0;
        const columns = Math.min(3, frames.length);
        const rows = Math.ceil(frames.length / columns);
        const tiles: OverlayOptions[] = [];
        for (let i = 0; i < frames.length; i++) {
          const output = path.join(
            directory,
            `${i}.${preview.imageFormat === "jpeg" ? "jpg" : "png"}`,
          );
          await renderStill({
            serveUrl,
            composition,
            puppeteerInstance,
            inputProps: project.inputProps,
            frame: frames[i],
            output,
            scale: preview.scale,
            imageFormat: preview.imageFormat,
            ...(preview.jpegQuality !== undefined
              ? { jpegQuality: preview.jpegQuality }
              : {}),
          });
          const frameImage = sharp(output);
          const dimensions = await frameImage.metadata();
          if (!dimensions.width || !dimensions.height)
            throw new Error("Renderer produced an image without dimensions.");
          if (i === 0) {
            tileWidth = dimensions.width;
            tileHeight = dimensions.height;
          }
          if (
            dimensions.width !== tileWidth ||
            dimensions.height !== tileHeight
          )
            throw new Error(
              "Preview frame dimensions changed during inspection.",
            );
          const left = (i % columns) * tileWidth;
          const top = Math.floor(i / columns) * (tileHeight + 32);
          tiles.push({
            input: await frameImage.toBuffer(),
            left,
            top,
          });
          tiles.push({
            input: Buffer.from(
              `<svg width="${tileWidth}" height="32"><rect width="100%" height="100%" fill="#18202b"/><text x="12" y="22" fill="white" font-family="sans-serif" font-size="17">Frame ${frames[i]}</text></svg>`,
            ),
            left,
            top: top + tileHeight,
          });
        }
        const sheet = sharp({
          create: {
            width: columns * tileWidth,
            height: rows * (tileHeight + 32),
            channels: 4,
            background: "#10151c",
          },
        }).composite(tiles);
        const image = await (
          preview.imageFormat === "jpeg"
            ? sheet
                .flatten({ background: "#10151c" })
                .jpeg({ quality: preview.jpegQuality })
            : sheet.png()
        ).toBuffer();
        return {
          content: [
            {
              type: "text" as const,
              text: `Rendered frames: ${frames.join(", ")}. Preview: ${tileWidth}x${tileHeight} at scale ${preview.scale.toFixed(4)} (${preview.imageFormat}). Inspect this contact sheet and fix issues before the single final export.`,
            },
            {
              type: "image" as const,
              mimeType:
                preview.imageFormat === "jpeg" ? "image/jpeg" : "image/png",
              data: image.toString("base64"),
            },
          ],
          structuredContent: {
            frames,
            ...metadata(composition),
            preview: {
              ...preview,
              width: tileWidth,
              height: tileHeight,
              sheetWidth: columns * tileWidth,
              sheetHeight: rows * (tileHeight + 32),
            },
          },
        };
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
}

export type VideoArtifact = {
  id: string;
  name: string;
  file: string;
  size: number;
  sessionId: string;
};
const artifacts = new Map<string, VideoArtifact>();
export function getArtifact(id: string) {
  return artifacts.get(id);
}

export async function exportVideo(
  sessionId: string,
  options: ExportVideoOptions = {},
) {
  options = exportVideoSchema.parse(options);
  const name = options.outputName ?? "video.mp4";
  if (
    !/^[\w .-]+\.mp4$/i.test(name) ||
    name.length > 128 ||
    name.includes("..")
  )
    throw new Error(
      "outputName must be a simple .mp4 filename (no directory paths).",
    );
  return withProject(
    sessionId,
    async ({ project, serveUrl, composition, puppeteerInstance }) => {
      if (composition.width % 2 || composition.height % 2)
        throw new Error(
          "H.264/yuv420p requires even width and height. Update the video metadata.",
        );
      const directory = await mkdtemp(
        path.join(tmpdir(), "remotion-mcp-export-"),
      );
      const file = path.join(directory, name);
      try {
        await renderMedia({
          serveUrl,
          composition,
          puppeteerInstance,
          inputProps: project.inputProps,
          codec: "h264",
          pixelFormat: "yuv420p",
          colorSpace: "bt709",
          outputLocation: file,
          concurrency: 2,
          scale: 1,
          muted: options.muted ?? false,
          enforceAudioTrack: false,
        });
        const id = randomUUID();
        const artifact = {
          id,
          name,
          file,
          size: (await stat(file)).size,
          sessionId,
        };
        artifacts.set(id, artifact);
        directories.add(directory);
        while (artifacts.size > 32) {
          const oldest = artifacts.values().next().value!;
          artifacts.delete(oldest.id);
          await rm(path.dirname(oldest.file), { recursive: true, force: true });
          directories.delete(path.dirname(oldest.file));
        }
        return {
          artifact,
          ...metadata(composition),
          muted: options.muted ?? false,
        };
      } catch (error) {
        await rm(directory, { recursive: true, force: true });
        throw error;
      }
    },
  );
}

export async function closeRenderer() {
  if (browser)
    await browser
      .then((instance) => instance.close({ silent: true }))
      .catch(() => {});
  browser = undefined;
  await Promise.all(
    [...directories].map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
  directories.clear();
  cache.clear();
  artifacts.clear();
}
