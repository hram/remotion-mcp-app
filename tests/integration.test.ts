import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { getVideoMetadata, RenderInternals } from "@remotion/renderer";
import { execFileSync } from "node:child_process";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import sharp from "sharp";
import server from "../index.js";
import { closeRenderer } from "../renderer/index.js";

test(
  "real MCP: cheap previews, two updates, one full-resolution silent export, errors and session isolation",
  { timeout: 240000 },
  async () => {
    const manifest = JSON.parse(
      await readFile(".mcp-use/build/manifest.json", "utf8"),
    );
    server.__primeViews(manifest.views);
    const { url } = await server.listen(0);
    const client = new Client({ name: "render-smoke", version: "1" });
    const other = new Client({ name: "isolated-session", version: "1" });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(url)));
      await other.connect(new StreamableHTTPClientTransport(new URL(url)));
      const call = async (name: string, args: Record<string, unknown> = {}) =>
        (await client.callTool(
          {
            name,
            arguments: args,
            _meta: { "openai/session": "smoke-session" },
          },
          undefined,
          { timeout: 180000 },
        )) as CallToolResult;
      const tools = await client.listTools();
      const anonymous = await other.callTool({
        name: "inspect_frames",
        arguments: {},
      });
      assert.equal(anonymous.isError, true);
      assert.match(JSON.stringify(anonymous.content), /No session identifier/);
      for (const name of [
        "create_video",
        "inspect_frames",
        "export_video",
        "read_me",
        "rule_react_code",
      ])
        assert.ok(tools.tools.some((tool) => tool.name === name));
      assert.equal((await call("inspect_frames")).isError, true);
      const source = `import {AbsoluteFill, useCurrentFrame} from "remotion";
      import {Box} from "./Box";
      import "./style.css";
      export default function Video(props){const frame=useCurrentFrame();return <AbsoluteFill style={{backgroundColor:props.color}}><Box frame={frame}/><div style={{position:'absolute',left:1000,top:0,width:80,height:80,background:window.devicePixelRatio < .6 ? '#ffffff' : '#ffff00'}}/></AbsoluteFill>;}`;
      const created = await call("create_video", {
        files: JSON.stringify({
          "/src/Video.tsx": source,
          "/src/Box.tsx":
            "export function Box({frame}){return <div className='box' style={{transform:`translateX(${frame*2}px)`}}>Visual feedback</div>;}",
          "/src/style.css": ".box {color:white;font-size:64px;margin:100px;}",
        }),
        width: 1080,
        height: 1080,
        fps: 30,
        durationInFrames: 150,
        defaultProps: { color: "#ff0000" },
      });
      assert.ok(
        !(created.content[0] as { text: string }).text.startsWith(
          "Project error",
        ),
      );
      const frames = [0, 30, 60, 90, 120, 149];
      const before = await call("inspect_frames", { frames });
      assert.ok(
        !before.isError,
        JSON.stringify(before.content.filter((c) => c.type === "text")),
      );
      assert.deepEqual(before.structuredContent, {
        frames,
        width: 1080,
        height: 1080,
        fps: 30,
        durationInFrames: 150,
        preview: {
          scale: 480 / 1080,
          width: 480,
          height: 480,
          imageFormat: "png",
          sheetWidth: 1440,
          sheetHeight: 1024,
        },
      });
      const image = before.content.find((c) => c.type === "image");
      assert.ok(image?.type === "image");
      const png = Buffer.from(image.data, "base64");
      assert.deepEqual(
        [...png.subarray(0, 8)],
        [137, 80, 78, 71, 13, 10, 26, 10],
      );
      const pixels = await sharp(png).raw().toBuffer();
      assert.ok(pixels[0] > 240 && pixels[1] < 10);
      assert.equal((await sharp(png).metadata()).width, 1440);
      // This marker is white only when Chromium renders at a reduced device scale.
      // Full-resolution rendering followed by resizing would leave it yellow.
      const channels = (await sharp(png).metadata()).channels!;
      const marker = 479 * channels;
      assert.ok(
        pixels[marker + 2] > 240,
        "Browser must render the preview at reduced scale, not resize a full-size screenshot",
      );
      const conflicting = await call("inspect_frames", {
        count: 6,
        scale: 0.5,
        previewWidth: 480,
      });
      assert.equal(conflicting.isError, true);
      const isolated = await other.callTool({
        name: "inspect_frames",
        arguments: {},
        _meta: { "openai/session": "other-session" },
      });
      assert.equal(isolated.isError, true);
      const invalid = await call("inspect_frames", { frames: [150] });
      assert.equal(invalid.isError, true);
      assert.match(JSON.stringify(invalid.content), /0\.\.149/);
      // The View's update_video delegates to this same create_video merge path.
      await call("create_video", {
        files: JSON.stringify({
          "/src/Box.tsx":
            "export function Box({frame}){return <div className='box'>Updated {frame}</div>;}",
        }),
        inputProps: { color: "#0000ff" },
      });
      const after = await call("inspect_frames", {
        frames,
        previewWidth: 480,
        imageFormat: "jpeg",
        jpegQuality: 70,
      });
      assert.ok(
        !after.isError,
        JSON.stringify(after.content.filter((c) => c.type === "text")),
      );
      const afterImage = after.content.find((c) => c.type === "image");
      assert.ok(afterImage?.type === "image");
      assert.equal(afterImage.mimeType, "image/jpeg");
      const afterJpeg = Buffer.from(afterImage.data, "base64");
      assert.equal(afterJpeg.readUInt16BE(0), 0xffd8);
      const afterPixels = await sharp(afterJpeg).raw().toBuffer();
      assert.ok(afterPixels[0] < 10 && afterPixels[2] > 240);
      assert.equal(
        (after.structuredContent?.preview as { width: number }).width,
        480,
      );
      assert.equal(
        (after.structuredContent?.preview as { jpegQuality: number })
          .jpegQuality,
        70,
      );
      // Second revision and a final cheap inspection; no draft MP4 exports.
      await call("create_video", {
        files: JSON.stringify({
          "/src/Box.tsx":
            "export function Box({frame}){return <div className='box'>Final {frame}</div>;}",
        }),
        inputProps: { color: "#00ff00" },
      });
      const finalDraft = await call("inspect_frames", {
        count: 7,
        scale: 1 / 3,
        imageFormat: "jpeg",
        jpegQuality: 65,
      });
      assert.ok(
        !finalDraft.isError,
        JSON.stringify(finalDraft.content.filter((c) => c.type === "text")),
      );
      const finalImage = finalDraft.content.find((c) => c.type === "image");
      assert.ok(finalImage?.type === "image");
      const finalJpeg = Buffer.from(finalImage.data, "base64");
      const finalPixels = await sharp(finalJpeg).raw().toBuffer();
      assert.ok(
        finalPixels[0] < 10 && finalPixels[1] > 240 && finalPixels[2] < 10,
      );
      assert.equal(
        (finalDraft.structuredContent?.preview as { width: number }).width,
        360,
      );
      assert.equal(
        (finalDraft.structuredContent?.frames as number[]).at(-1),
        149,
      );
      const exported = await call("export_video", {
        outputName: "smoke.mp4",
        muted: true,
      });
      assert.ok(!exported.isError, JSON.stringify(exported.content));
      const resource = exported.content.find((c) => c.type === "resource_link");
      assert.ok(resource?.type === "resource_link");
      const response = await fetch(resource.uri);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "video/mp4");
      const mp4 = Buffer.from(await response.arrayBuffer());
      assert.equal(mp4.toString("ascii", 4, 8), "ftyp");
      const artifacts = await mkdtemp(
        path.join(tmpdir(), "remotion-mcp-smoke-"),
      );
      await writeFile(path.join(artifacts, "before.png"), png);
      await writeFile(path.join(artifacts, "after.jpg"), afterJpeg);
      await writeFile(path.join(artifacts, "final-draft.jpg"), finalJpeg);
      await writeFile(path.join(artifacts, "smoke.mp4"), mp4);
      const video = await getVideoMetadata(path.join(artifacts, "smoke.mp4"));
      assert.equal(video.codec, "h264");
      assert.equal(video.pixelFormat, "yuv420p");
      assert.equal(video.canPlayInVideoTag, true);
      assert.equal(video.width, 1080);
      assert.equal(video.height, 1080);
      assert.equal(video.fps, 30);
      assert.equal(video.audioCodec, null);
      assert.equal(exported.structuredContent?.muted, true);
      // Container duration may include AAC encoder padding; verify video frames directly.
      const ffprobe = RenderInternals.getExecutablePath({
        type: "ffprobe",
        indent: false,
        logLevel: "error",
        binariesDirectory: null,
      });
      const probe = JSON.parse(
        execFileSync(
          ffprobe,
          [
            "-v",
            "error",
            "-show_streams",
            "-of",
            "json",
            path.join(artifacts, "smoke.mp4"),
          ],
          { encoding: "utf8" },
        ),
      );
      assert.equal(Number(probe.streams[0].nb_frames), 150);
      assert.equal(Number(probe.streams[0].duration), 5);
      assert.ok(
        probe.streams.every(
          (stream: { codec_type: string }) => stream.codec_type !== "audio",
        ),
      );
      console.log(`Smoke artifacts: ${artifacts}`);
      // Metadata is evaluated from merged props, including the final-frame boundary.
      await call("create_video", {
        files: JSON.stringify({
          "/src/Video.tsx":
            source +
            "\nexport const calculateMetadata=({props})=>({durationInFrames:props.frames,width:320,height:240,fps:24});",
        }),
        inputProps: { color: "#00ff00", frames: 3 },
      });
      const meta = await call("inspect_frames", { frames: [2] });
      assert.ok(
        !meta.isError,
        JSON.stringify(meta.content.filter((c) => c.type === "text")),
      );
      assert.deepEqual(meta.structuredContent, {
        frames: [2],
        width: 320,
        height: 240,
        fps: 24,
        durationInFrames: 3,
        preview: {
          scale: 1,
          width: 320,
          height: 240,
          imageFormat: "png",
          sheetWidth: 320,
          sheetHeight: 272,
        },
      });
      assert.equal(
        (await call("inspect_frames", { frames: [3] })).isError,
        true,
      );
      await call("create_video", {
        files: JSON.stringify({
          "/src/Video.tsx":
            "export default function Video(){throw new Error('Intentional render failure');}",
        }),
      });
      const runtime = await call("inspect_frames", { frames: [0] });
      assert.equal(runtime.isError, true);
      assert.match(
        JSON.stringify(runtime.content),
        /Intentional render failure/,
      );
      await call("create_video", {
        files: JSON.stringify({
          "/src/Video.tsx": "export default function {",
        }),
      });
      const compile = await call("inspect_frames");
      assert.equal(compile.isError, true);
      assert.match(JSON.stringify(compile.content), /compilation error/);
    } finally {
      await client.close();
      await other.close();
      await closeRenderer();
      await server.close();
    }
  },
);
