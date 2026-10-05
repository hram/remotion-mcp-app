import { readFile, mkdir, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileAndRespondWithProject } from "../../utils.js";
import { inspectFrames, exportVideo, closeRenderer } from "../../renderer/index.js";

const sourcePath = fileURLToPath(new URL("./Video.tsx", import.meta.url));
const outputDirectory = path.resolve(process.argv[2] ?? "artifacts/hello-world");
await mkdir(outputDirectory, { recursive: true });
try {
  const source = await readFile(sourcePath, "utf8");
  const created = await compileAndRespondWithProject({
    title: "Hello World — Aurora", compositionId: "HelloWorld", width: 1920, height: 1080,
    fps: 30, durationInFrames: 180, entryFile: "/src/Video.tsx",
    files: { "/src/Video.tsx": source }, defaultProps: {}, inputProps: {},
  }, "hello-world-demo", [], "create_video");
  if (created.content[0].text.startsWith("Project error:")) throw new Error(created.content[0].text);
  const inspected = await inspectFrames("hello-world-demo", { frames: [0, 24, 48, 90, 135, 179] });
  const image = inspected.content.find((item) => item.type === "image");
  if (!image || image.type !== "image") throw new Error("Missing contact sheet");
  await writeFile(path.join(outputDirectory, "contact-sheet.png"), Buffer.from(image.data, "base64"));
  await copyFile(sourcePath, path.join(outputDirectory, "Video.tsx"));
  console.log(`Contact sheet: ${path.join(outputDirectory, "contact-sheet.png")}`);
  if (!process.argv.includes("--inspect-only")) {
    const { artifact } = await exportVideo("hello-world-demo", { outputName: "hello-world.mp4" });
    await copyFile(artifact.file, path.join(outputDirectory, artifact.name));
    console.log(`Video: ${path.join(outputDirectory, artifact.name)}`);
  }
} finally { await closeRenderer(); }
