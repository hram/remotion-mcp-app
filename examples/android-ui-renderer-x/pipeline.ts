import { createInterface } from "node:readline";
import { readFile, mkdir, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import server from "../../index.js";
import { closeRenderer } from "../../renderer/index.js";

const source = new URL("./Video.tsx", import.meta.url);
const outputDirectory = path.resolve(process.argv[2] ?? "artifacts/android-ui-renderer-x");
await mkdir(outputDirectory, { recursive: true });
const manifest = JSON.parse(await readFile(".mcp-use/build/manifest.json", "utf8"));
server.__primeViews(manifest.views);
const { url } = await server.listen(0, { host: "127.0.0.1" });
const client = new Client({ name: "autonomous-remotion-draft-loop", version: "1" });
await client.connect(new StreamableHTTPClientTransport(new URL(url)));
const session = randomUUID();
const log: Array<Record<string, unknown>> = [];
let revision = "";
let lastInspection = "";
let exports = 0;
const call = async (name: string, args: Record<string, unknown>) => {
  const started = Date.now();
  const result = await client.callTool({ name, arguments: args, _meta: { "openai/session": session } }, undefined, { timeout: 300000 }) as CallToolResult;
  if (result.isError || result.content.some((item) => item.type === "text" && item.text.startsWith("Project error:"))) throw new Error(JSON.stringify(result.content));
  log.push({ tool: name, revision, elapsedMs: Date.now() - started, ...(name === "create_video" ? {} : { arguments: args }), metadata: name === "create_video" ? { width: 1920, height: 1080, fps: 30, durationInFrames: 210 } : result.structuredContent });
  await writeFile(path.join(outputDirectory, "pipeline-log.json"), JSON.stringify({ session, exports, calls: log }, null, 2));
  return result;
};

console.log("READY. Commands: create <revision>, inspect, export, quit");
const commands = createInterface({ input: process.stdin });
try {
  for await (const line of commands) {
    const [command, name] = line.trim().split(/\s+/);
    try {
      if (command === "quit") break;
      if (command === "create") {
        if (!name || !/^[\w-]+$/.test(name)) throw new Error("Specify a simple revision name");
        revision = name;
        const code = await readFile(source, "utf8");
        await call("create_video", { files: JSON.stringify({ "/src/Video.tsx": code }), title: "Android UI Renderer MCP — X", width: 1920, height: 1080, fps: 30, durationInFrames: 210 });
        await writeFile(path.join(outputDirectory, `${revision}-Video.tsx`), code);
        lastInspection = "";
        console.log(`CREATED ${revision}`);
      } else if (command === "inspect") {
        const result = await call("inspect_frames", { frames: [0, 35, 70, 105, 140, 175, 209], previewWidth: 480, imageFormat: "jpeg", jpegQuality: 80 });
        const image = result.content.find((item) => item.type === "image");
        if (!image || image.type !== "image") throw new Error("Missing MCP image content");
        const output = path.join(outputDirectory, `${revision}-contact-sheet.jpg`);
        await writeFile(output, Buffer.from(image.data, "base64"));
        await writeFile(path.join(outputDirectory, `${revision}-preview.json`), JSON.stringify(result.structuredContent, null, 2));
        lastInspection = revision;
        console.log(`INSPECTED ${output}`);
      } else if (command === "export") {
        if (exports) throw new Error("Final export has already been called");
        if (!revision || lastInspection !== revision || log.filter((entry) => entry.tool === "inspect_frames").length < 3) throw new Error("Inspect three revisions before final export");
        exports++;
        const result = await call("export_video", { outputName: "android-ui-renderer-x.mp4", muted: true });
        const resource = result.content.find((item) => item.type === "resource_link");
        if (!resource || resource.type !== "resource_link") throw new Error("Missing MP4 resource link");
        const response = await fetch(resource.uri);
        if (!response.ok) throw new Error(`Download failed: ${response.status}`);
        const output = path.join(outputDirectory, resource.name);
        await writeFile(output, Buffer.from(await response.arrayBuffer()));
        await copyFile(source, path.join(outputDirectory, "Video.tsx"));
        console.log(`EXPORTED ${output}`);
      } else if (command) throw new Error("Unknown command");
    } catch (error) { console.error("COMMAND ERROR", error); }
  }
} finally { commands.close(); process.stdin.pause(); await client.close(); await closeRenderer(); await server.close(); }
