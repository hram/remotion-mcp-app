<p align="center">
  <a href="https://github.com/mcp-use/remotion-mcp-app/releases/download/v1.0.0/ClaudeRemotionDemo.mp4">
    <img src="assets/demo-claude.gif" alt="Remotion MCP App Demo" width="100%"/>
  </a>
</p>

# Remotion MCP App

An [MCP App](https://mcp-use.com) for AI-powered video creation. It combines an MCP server with an interactive View — the model writes React/[Remotion](https://remotion.dev) code, the server compiles it in real-time, and a live video player renders the result directly inside the chat.

Unlike a standard MCP server that only returns text, an **MCP App** bundles a full UI View alongside its tools. The Remotion Player View renders inline in any compatible client (ChatGPT, Claude, or custom apps built with [mcp-use](https://mcp-use.com)), giving the model a visual canvas it can iterate on.

## Try it now

Connect to the hosted instance:

```
https://still-feather-l5mwy.run.mcp-use.com/mcp
```

### Setup on ChatGPT

1. Open **Settings** > **Apps and Connectors** > **Advanced Settings** and enable **Developer Mode**
2. Go to **Connectors** > **Create**, name it "Remotion", paste the URL above
3. In a new chat, click **+** > **More** and select the Remotion connector

> Requires ChatGPT Pro, Team, Enterprise, or Edu. [Full guide](https://developers.openai.com/apps-sdk/deploy/connect-chatgpt/)

### Setup on Claude

1. Open **Settings** > **Connectors** > **Add custom connector**
2. Paste the URL above and save
3. The Remotion tools will be available in new conversations

> Requires Claude Pro, Max, Team, or Enterprise. [Full guide](https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp)

## Demos

### ChatGPT + Remotion MCP App

[![OpenAI demo](assets/demo-openai.gif)](https://github.com/mcp-use/remotion-mcp-app/releases/download/v1.0.0/openairemotion.mp4)

### Claude + Remotion MCP App

[![Claude demo](assets/demo-claude.gif)](https://github.com/mcp-use/remotion-mcp-app/releases/download/v1.0.0/ClaudeRemotionDemo.mp4)

> Click the previews above to watch the full demos.

## How it works

This is an **MCP App** — an MCP server paired with a UI View. The two pieces work together:

1. **MCP Server** -- exposes `create_video` tool + rule tools for teaching Remotion patterns
2. **View** -- a Remotion Player that renders inline in the chat and receives compiled bundles from the server

The flow:

1. The model calls `create_video` with React/Remotion source files
2. The server compiles the project with esbuild (sub-second)
3. The compiled bundle is sent back as `structuredContent`, and the View renders it as a playable video
4. For edits, the mounted View exposes `update_video`; it sends only changed files through the server compiler and swaps the player in place

```
Model                     MCP App (Server + View)
  |                          |
  |-- create_video({files}) ->|
  |                          |-- esbuild compile
  |<- structuredContent -----|
  |                          |-- View renders video inline
  |                          |
  |-- update_video({edits}) ->|  (View tool)
  |                          |-- create_video merges + recompiles
  |                          |-- existing View swaps the player in place
```

### Creation and in-place editing

The server exposes `create_video` for the initial composition, plus `inspect_frames` and `export_video` for observation and export. Once its View is mounted, the View exposes an ephemeral `update_video` tool. That tool reuses the server compiler, merges only the changed files with the current session project, and replaces the mounted player without creating another View result.

### Agent visual feedback loop

```text
create_video → inspect_frames → update_video → inspect_frames → export_video
```

The Live Player is for the human; `inspect_frames` gives the AI agent actual rendered images; `export_video` produces the final downloadable artifact. The MCP server does not call an AI API or critique the video itself: the agent inspects the image and decides how to improve the React/Remotion source.

```javascript
create_video({
  files: JSON.stringify({
    "/src/Video.tsx": 'import {AbsoluteFill, useCurrentFrame} from "remotion"; export default function Video(){const frame=useCurrentFrame(); return <AbsoluteFill style={{backgroundColor:"#18202b",color:"white",fontSize:64,justifyContent:"center",alignItems:"center"}}><div style={{transform:`translateX(${frame}px)`}}>Hello</div></AbsoluteFill>;',
  }),
  width: 1080, height: 1080, fps: 30, durationInFrames: 150,
});
inspect_frames({frames: [0, 30, 60, 90, 120, 149], previewWidth: 480, imageFormat: "jpeg", jpegQuality: 75});
// Inspect the returned image, then call the mounted View's update_video
// with changed files/metadata/props. Without a View, use create_video to merge edits.
inspect_frames({count: 6, scale: 0.4, imageFormat: "jpeg", jpegQuality: 75});
// Repeat cheap inspection and fixes as needed. Export once after final inspection.
export_video({outputName: "video.mp4", codec: "h264", muted: true});
```

`inspect_frames` accepts either explicit zero-based `frames` (1–24 entries) or `count` (1–24, default 6). Automatic sampling spans the timeline and includes `durationInFrames - 1`; it returns fewer samples for very short videos. The labeled contact sheet is returned as MCP `{type: "image", mimeType: "image/png" | "image/jpeg", data: "<base64>"}` content. It is not just a filesystem path or URL.

Preview frames are rendered at reduced resolution **inside Remotion**, not rendered at full resolution and resized afterward. Composition metadata and props remain unchanged. By default previews fit within 480×480 without upscaling. Set either `previewWidth` (integer 1–1920, preserving aspect ratio) or `scale` (0 < scale ≤ 1). These parameters are mutually exclusive. An explicit `scale: 1` requests full-resolution stills for the occasions that need them. Extreme scales producing a dimension below one pixel are rejected.

`imageFormat` defaults to `png` for compatibility. Use `jpeg` with optional `jpegQuality` (1–100, default 80) to compress both rendered frames and the final contact sheet. Quality is only accepted with JPEG. JPEG uses an opaque contact-sheet background; PNG frame transparency is composited over the sheet background. Structured metadata retains the original composition `width`, `height`, `fps`, and `durationInFrames`, plus a separate `preview` object containing the effective `scale`, actual rendered frame `width`/`height`, `imageFormat`, JPEG quality when applicable, and `sheetWidth`/`sheetHeight`.

For a fast draft loop, inspect only 5–7 representative frames per revision, including first and last frames. Visually evaluate readability, spacing, clipping, overlaps and loop continuity, fix concrete issues, then inspect again. Do not export draft MP4s or render every timeline frame during design iterations. When the requested workflow calls for two visual iterations, make two meaningful fixes and finish with a final contact-sheet check before one export. Sparse stills help review layout and endpoints but do not prove motion is smooth between samples.

`export_video` renders H.264 MP4 with `yuv420p` at full resolution (`scale: 1`), using current metadata and merged props. Preview settings never carry over to export. Dimensions must be even. Set `muted: true` to omit the audio track entirely; the default is `false`, preserving existing audio behavior. The result includes the chosen `muted` setting, a `resource_link` and structured download URL/name/size. The HTTP download endpoint serves the actual MP4 with `Content-Disposition: attachment`. Set `REMOTION_PUBLIC_URL` to the public server origin when running behind a reverse proxy; otherwise the request origin is used. Download URLs contain random UUIDs and act as bearer capabilities: anyone with the URL can download that artifact.

Both tools use the same in-memory session state as `create_video` and the View's `update_video`, including the latest edits. They report missing projects, invalid frames, compilation failures and renderer failures to the agent. `calculateMetadata` is evaluated with current props before selecting frame ranges or exporting.

Session lookup uses request `_meta["openai/session"]`, `mcp-session-id`, `x-remotion-session-id`, or the existing `openai/subject` fallback. Stateless clients should send a stable, unique conversation ID on every call, including View edits. Requests without any identifier are rejected instead of sharing a global anonymous project. These identifiers route project state; they are not authentication credentials.

#### Rendering bridge and resource lifecycle

The existing esbuild compiler resolves virtual source files and emits the same JavaScript bundle used by the Player. A temporary generated Remotion entry installs the matching React/Remotion runtime modules, executes that bundle, and registers a standard `Composition` with its default component, optional `calculateMetadata`, metadata and default props. `@remotion/bundler` builds a normal serving bundle; `@remotion/renderer` performs actual browser rendering. Imported CSS is retained for both the Player and headless renderer.

Preparation is cached per session project revision (up to 16 cached revisions when idle; active renders are not evicted), and a headless browser is shared across calls. Source or metadata/props edits produce a new revision; selected composition metadata is evaluated on each call. Frames within an inspection reuse the same serving bundle and browser. Temporary frame files are removed immediately. The latest 32 exports are retained until eviction or shutdown; they are not persistent storage. SIGTERM/SIGINT close the browser and remove generated files. Sessions and exports are local to one server process and disappear on restart; deployments with multiple workers need sticky routing or shared storage. A lost browser must be recovered by restarting the process in this MVP.

The first render downloads Chrome Headless Shell if needed. A Node server with a writable temporary directory and Chrome's Linux dependencies is required. Set `REMOTION_BROWSER_EXECUTABLE` to use a preinstalled compatible browser. Packages are pinned to Remotion 4.0.505, matching the Player. Rendering arbitrary user code requires a trusted deployment or an isolated worker environment; this MVP adds no execution sandbox.

#### Local verification

```bash
npm install
npm run typecheck
npm test
npm run test:integration
```

The integration command builds the actual View and runs a real HTTP MCP client through create → inspect → update → inspect → update → final inspect → one export. It checks PNG/JPEG image content, reduced browser rendering scale (using a device-pixel-ratio marker), changed pixels, 480px/360px previews, metadata, session isolation, invalid parameters/frames, compilation/runtime errors, and a full-resolution five-second 1080×1080 H.264 video with no audio stream. It prints a temporary directory containing contact sheets and the MP4. Browser installation may require network access on the first run. Unit tests do not launch a browser.

### Rule tools

The server includes teaching tools derived from the [remotion-best-practices](https://github.com/remotion-dev/skills) skill that the model can call to learn Remotion patterns:

| Tool | Topic |
|------|-------|
| `rule_react_code` | Project structure, imports, entry file contract |
| `rule_remotion_animations` | `useCurrentFrame`, frame-driven animation |
| `rule_remotion_timing` | `interpolate`, `spring`, `Easing` configs |
| `rule_remotion_sequencing` | `Sequence`, scene management, duration |
| `rule_remotion_transitions` | `TransitionSeries`, fade, slide, wipe |
| `rule_remotion_text_animations` | Typewriter effect, word highlighting |
| `rule_remotion_trimming` | Trimming with negative `Sequence` from |

### View (the "App" part)

The Remotion Player View is what makes this an MCP App rather than a plain MCP server. It runs inside the chat interface and features:

- Live video playback with controls
- Animated loading state with shader gradient while the model writes code
- Editing overlay (blur + gradient) when updating an existing video
- Ephemeral `update_video` View tool for in-place agent edits
- Fullscreen mode
- Error display with compilation error details

## Local development

### Prerequisites

- Node.js 22.22.2+
- npm or pnpm

### Setup

```bash
git clone https://github.com/mcp-use/remotion-mcp-app.git
cd remotion-mcp-app
npm install
npm run dev
```

`npm run dev` builds the View inline before opening the embedded Inspector. This keeps the v2 View compatible with the Inspector sandbox, so the animated gradient loading state mounts instead of getting stuck on the host's fallback `Compiling...` spinner. Use `npm run dev:hmr` when testing outside that embedded sandbox and Vite hot reload is more useful.

The server starts at `http://localhost:3000/mcp`.

### Connect a client

Point any MCP client at `http://localhost:3000/mcp`. For example with [mcp-use](https://mcp-use.com):

```json
{
  "mcpServers": {
    "remotion": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

### Build and deploy

```bash
npm run build
npm run deploy
```

## Project structure

```
index.ts                     -- MCP server, tool definitions, handler
utils.ts                     -- esbuild compilation, session state, response helpers
types.ts                     -- Shared types (VideoProjectData, VideoMeta)
renderer/index.ts            -- Headless preparation, contact sheets, MP4 export and caches
tests/                       -- Unit and real HTTP MCP rendering smoke tests
rules/                       -- Remotion teaching content served by rule tools
views/remotion-player/       -- MCP App View (React + Remotion Player)
  view.tsx                   -- Main View component
  types.ts                   -- Browser-only View types and runtime constants
  components/
    CodeComposition.tsx      -- CSP-safe blob module compiler + runtime shim
```

## Tool schema

```typescript
create_video({
  files: string,            // REQUIRED -- JSON string of {path: code}
  entryFile?: string,       // Default: "/src/Video.tsx"
  title?: string,
  durationInFrames?: number, // Default: 150
  fps?: number,             // Default: 30
  width?: number,           // Default: 1920
  height?: number,          // Default: 1080
  defaultProps?: object,    // Component default props (preserved unless replaced)
  inputProps?: object,      // Current props, merged over defaultProps
})
```

The `files` parameter is a JSON string mapping virtual file paths to source code:

```json
{
  "/src/Video.tsx": "import {AbsoluteFill} from \"remotion\";\nexport default function Video() { return <AbsoluteFill />; }"
}
```

## Session behavior

- ChatGPT conversations maintain isolated project state; other clients fall back to caller or transport identity
- Calling `create_video` merges new files with the previous project
- Metadata (title, fps, dimensions) carries forward unless overridden
- Sessions are capped at 250 concurrent projects with LRU eviction

## License

MIT -- see [LICENSE](LICENSE) for details.

Note: [Remotion](https://remotion.dev) is a dependency with its own license. Free for individuals and companies with up to 3 employees. Larger organizations need a [company license](https://www.remotion.pro/license).

---

Built with [mcp-use](https://mcp-use.com) and [Remotion](https://remotion.dev). Rule tools adapted from the [remotion-best-practices](https://github.com/remotion-dev/skills) skill by Remotion.
