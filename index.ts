import { MCPServer } from "mcp-use";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { closeRenderer, inspectFrames, exportVideo, getArtifact } from "./renderer/index.js";
import { inspectFramesSchema, exportVideoSchema } from "./renderer/options.js";
import { observeMcpToolCall, posthog } from "./observability.js";
import { RULE_INDEX } from "./rules/index.js";
import { RULE_REACT_CODE } from "./rules/react-code.js";
import { RULE_REMOTION_ANIMATIONS } from "./rules/remotion-animations.js";
import { RULE_REMOTION_TIMING } from "./rules/remotion-timing.js";
import { RULE_REMOTION_SEQUENCING } from "./rules/remotion-sequencing.js";
import { RULE_REMOTION_TRANSITIONS } from "./rules/remotion-transitions.js";
import { RULE_REMOTION_TEXT_ANIMATIONS } from "./rules/remotion-text-animations.js";
import { RULE_REMOTION_TRIMMING } from "./rules/remotion-trimming.js";
import {
  DEFAULT_META,
  compileAndRespondWithProject,
  failProject,
  formatZodIssues,
  getSessionProject,
  resolveSessionId,
} from "./utils.js";

const server = new MCPServer({
  name: "remotion-mcp",
  title: "Remotion Video Creator",
  version: "2.0.0",
  host: "0.0.0.0",
  description:
    "Create Remotion videos from multi-file React projects with props-first composition design.",
});

if (posthog) {
  server.use("mcp:tools/call", observeMcpToolCall);
}

async function shutdown() {
  await closeRenderer();
  if (posthog) await posthog.shutdown();
  process.exit(0);
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

// --- Rule tools ---

export const readMe = server.tool(
  { name: "read_me", description: "IMPORTANT: Call this FIRST. Returns the guide overview and lists all available rule tools." },
  async () => ({ content: [{ type: "text", text: RULE_INDEX }] })
);

export const ruleReactCode = server.tool(
  { name: "rule_react_code", description: "Project code reference: file structure, supported imports, component/props patterns" },
  async () => ({ content: [{ type: "text", text: RULE_REACT_CODE }] })
);

export const ruleRemotionAnimations = server.tool(
  { name: "rule_remotion_animations", description: "Remotion animations: useCurrentFrame, frame-driven animation fundamentals" },
  async () => ({ content: [{ type: "text", text: RULE_REMOTION_ANIMATIONS }] })
);

export const ruleRemotionTiming = server.tool(
  { name: "rule_remotion_timing", description: "Remotion timing: interpolate, spring, Easing, spring configs, delay, duration" },
  async () => ({ content: [{ type: "text", text: RULE_REMOTION_TIMING }] })
);

export const ruleRemotionSequencing = server.tool(
  { name: "rule_remotion_sequencing", description: "Remotion sequencing: Sequence, delay, nested timing, local frames" },
  async () => ({ content: [{ type: "text", text: RULE_REMOTION_SEQUENCING }] })
);

export const ruleRemotionTransitions = server.tool(
  { name: "rule_remotion_transitions", description: "Remotion transitions: TransitionSeries, fade, slide, wipe, flip, duration calculation" },
  async () => ({ content: [{ type: "text", text: RULE_REMOTION_TRANSITIONS }] })
);

export const ruleRemotionTextAnimations = server.tool(
  { name: "rule_remotion_text_animations", description: "Remotion text: typewriter effect, word highlighting, string slicing" },
  async () => ({ content: [{ type: "text", text: RULE_REMOTION_TEXT_ANIMATIONS }] })
);

export const ruleRemotionTrimming = server.tool(
  { name: "rule_remotion_trimming", description: "Remotion trimming: cut start/end of animations with negative Sequence from" },
  async () => ({ content: [{ type: "text", text: RULE_REMOTION_TRIMMING }] })
);

// --- Video tool ---

const projectVideoSchema = z.object({
  title: z.string().optional().default(DEFAULT_META.title),
  compositionId: z.string().optional().default(DEFAULT_META.compositionId),
  width: z.number().optional().default(DEFAULT_META.width),
  height: z.number().optional().default(DEFAULT_META.height),
  fps: z.number().optional().default(DEFAULT_META.fps),
  durationInFrames: z.number().optional().default(DEFAULT_META.durationInFrames),
  entryFile: z.string().optional().default("/src/Video.tsx"),
  files: z.record(z.string(), z.string()),
  defaultProps: z.record(z.string(), z.unknown()).optional().default({}),
  inputProps: z.record(z.string(), z.unknown()).optional().default({}),
});

const createVideoSchema = z.object({
  files: z.string().describe(
    'REQUIRED. A JSON string of {path: code} mapping file paths to source code. Example: \'{"\/src\/Video.tsx":"import {AbsoluteFill} from \\"remotion\\";\\nexport default function Video(){return <AbsoluteFill\/>;}"}\'. For edits, only include changed files — unchanged files are kept from the previous call.'
  ),
  entryFile: z.string().optional().describe('Entry file path (default: "/src/Video.tsx"). Must match a key in files.'),
  title: z.string().optional().describe("Title shown in the video player"),
  durationInFrames: z.number().optional().describe("Total duration in frames (default: 150)"),
  fps: z.number().optional().describe("Frames per second (default: 30)"),
  width: z.number().optional().describe("Width in pixels (default: 1920)"),
  height: z.number().optional().describe("Height in pixels (default: 1080)"),
  defaultProps: z.record(z.string(), z.unknown()).optional(),
  inputProps: z.record(z.string(), z.unknown()).optional(),
});

const createVideoOutputSchema = z.object({
  videoProject: z.string().describe("Serialized compiled Remotion project consumed by the player view"),
});

export const createVideo = server.tool(
  {
    name: "create_video",
    description:
      "Create or update a video. The `files` param is a JSON string (not an object) mapping file paths to source code. " +
      'Pass it as: files: JSON.stringify({"/src/Video.tsx": "...your code..."}). ' +
      "For edits, only include changed files — previous files are preserved automatically.",
    inputSchema: createVideoSchema,
    outputSchema: createVideoOutputSchema,
    view: {
      name: "remotion-player",
      description: "Interactive Remotion video player",
      prefersBorder: false,
      csp: {
        resourceDomains: ["https://images.unsplash.com", "https://picsum.photos"],
      },
    },
  },
  async (rawParams: z.infer<typeof createVideoSchema>, ctx) => {
    let sessionId: string;
    try { sessionId = resolveSessionId(ctx); } catch (error) { return failProject((error as Error).message); }

    // Parse files from JSON string
    let files: Record<string, string>;
    try {
      const parsed = JSON.parse(rawParams.files);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return failProject('files must be a JSON object like {"\/src\/Video.tsx": "...code..."}');
      }
      files = parsed as Record<string, string>;
    } catch {
      return failProject('files must be a valid JSON string, e.g. \'{"\/src\/Video.tsx":"...code..."}\'');
    }

    if (Object.keys(files).length === 0) {
      return failProject('files must contain at least one file entry.');
    }

    // Merge with previous session state (if any)
    const previous = getSessionProject(sessionId);
    const mergedFiles = previous
      ? { ...previous.files, ...files }
      : files;

    const project = {
      title: rawParams.title ?? previous?.title,
      compositionId: previous?.compositionId,
      width: rawParams.width ?? previous?.width,
      height: rawParams.height ?? previous?.height,
      fps: rawParams.fps ?? previous?.fps,
      durationInFrames: rawParams.durationInFrames ?? previous?.durationInFrames,
      entryFile: rawParams.entryFile ?? previous?.entryFile,
      files: mergedFiles,
      defaultProps: rawParams.defaultProps ?? previous?.defaultProps,
      inputProps: rawParams.inputProps ?? previous?.inputProps,
    };

    const parseResult = projectVideoSchema.safeParse(project);
    if (!parseResult.success) {
      return failProject(`Invalid input: ${formatZodIssues(parseResult.error)}`);
    }

    const statusLines: string[] = [];
    if (previous) {
      statusLines.push("Merged with previous project.");
    }

    return compileAndRespondWithProject(parseResult.data, sessionId, statusLines, "create_video");
  }
);

function renderFailure(error: unknown) {
  return { isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.stack ?? error.message : String(error) }] };
}

export const inspectVideoFrames = server.tool({
  name: "inspect_frames",
  description: "Render a few frames of the current session video as image content for visual critique. Defaults to reduced-resolution frames fitting within 480x480; use previewWidth or scale and optional JPEG compression for cheap drafts. Inspect 5–7 frames, fix issues, repeat; export only once when ready. No source code needs to be resent.",
  inputSchema: inspectFramesSchema,
}, async (params, ctx) => {
  try { return await inspectFrames(resolveSessionId(ctx), params); } catch (error) { return renderFailure(error); }
});

export const exportCurrentVideo = server.tool({
  name: "export_video",
  description: "Render the current session video at full resolution to H.264/yuv420p MP4 and return a downloadable file resource. Use cheap inspect_frames during iterations; call this once after final visual inspection. Set muted: true for a video without an audio track.",
  inputSchema: exportVideoSchema,
}, async (params, ctx) => {
  try {
    const sessionId = resolveSessionId(ctx);
    const { artifact, ...meta } = await exportVideo(sessionId, params);
    const base = process.env.REMOTION_PUBLIC_URL ?? (ctx.request ? new URL(ctx.request.url).origin : "http://localhost:3000");
    const url = new URL(`/artifacts/${artifact.id}`, base).href;
    return {
      content: [{ type: "text" as const, text: `Exported ${artifact.name} (${artifact.size} bytes). Download: ${url}` }, { type: "resource_link" as const, uri: url, name: artifact.name, mimeType: "video/mp4", size: artifact.size }],
      structuredContent: { ...meta, url, name: artifact.name, size: artifact.size, mimeType: "video/mp4" },
    };
  } catch (error) { return renderFailure(error); }
});

// UUID URLs are bearer capabilities; source/session identifiers are never exposed.
server.get("/artifacts/:id", async (c) => {
  const artifact = getArtifact(c.req.param("id"));
  if (!artifact) return c.text("Artifact not found or expired", 404);
  return new Response(new Uint8Array(await readFile(artifact.file)), { headers: {
    "Content-Type": "video/mp4",
    "Content-Disposition": `attachment; filename="${artifact.name}"`,
    "Content-Length": String(artifact.size),
    "Cache-Control": "private, no-store",
  } });
});

server.get("/.well-known/openai-apps-challenge", (c) => {
  return c.text("gP0NHv0ywqzsT3-iJ5is_xR6HysaW9Gbls7TeneGl8M");
});

export default server;
