import { test } from "node:test";
import assert from "node:assert/strict";
import { selectFrames, inspectFrames, exportVideo } from "../renderer/index.js";
import {
  resolvePreviewOptions,
  inspectFramesSchema,
  exportVideoSchema,
} from "../renderer/options.js";
import {
  compileAndRespondWithProject,
  DEFAULT_META,
  getSessionProject,
} from "../utils.js";

test("representative frames include the last valid frame, even for short videos", () => {
  assert.deepEqual(selectFrames(150), [0, 30, 60, 89, 119, 149]);
  assert.deepEqual(selectFrames(1), [0]);
  assert.deepEqual(selectFrames(3), [0, 1, 2]);
  assert.deepEqual(
    selectFrames(150, [0, 30, 60, 90, 120, 149]),
    [0, 30, 60, 90, 120, 149],
  );
  assert.deepEqual(selectFrames(150, undefined, 1), [0]);
});

test("invalid frame numbers and sample sizes fail with useful errors", () => {
  for (const frame of [150, -1, 1.5, NaN])
    assert.throws(
      () => selectFrames(150, [frame]),
      /outside valid range 0\.\.149/,
    );
  for (const count of [0, 25, 2.5])
    assert.throws(() => selectFrames(150, undefined, count), /count/);
  assert.throws(() => selectFrames(150, []), /frames/);
});

test("draft resolution defaults to 480px on the longest edge and never upscales", () => {
  assert.equal(resolvePreviewOptions(1080, 1080).scale, 480 / 1080);
  assert.equal(resolvePreviewOptions(1920, 1080).scale, 0.25);
  assert.equal(resolvePreviewOptions(1080, 1920).scale, 0.25);
  assert.equal(resolvePreviewOptions(320, 240).scale, 1);
  assert.equal(
    resolvePreviewOptions(1080, 1080, { previewWidth: 360 }).scale,
    1 / 3,
  );
  assert.equal(resolvePreviewOptions(320, 240, { previewWidth: 480 }).scale, 1);
  assert.equal(resolvePreviewOptions(1080, 1080, { scale: 0.5 }).scale, 0.5);
  assert.equal(resolvePreviewOptions(1080, 1080, { scale: 1 }).scale, 1);
});

test("JPEG settings and conflicting or invalid preview options are validated", () => {
  assert.deepEqual(resolvePreviewOptions(1080, 1080, { imageFormat: "jpeg" }), {
    scale: 480 / 1080,
    imageFormat: "jpeg",
    jpegQuality: 80,
  });
  assert.equal(
    resolvePreviewOptions(1080, 1080, { imageFormat: "jpeg", jpegQuality: 60 })
      .jpegQuality,
    60,
  );
  for (const options of [
    { scale: 0 },
    { scale: 1.1 },
    { scale: NaN },
    { previewWidth: 0 },
    { previewWidth: 1.5 },
    { scale: 0.5, previewWidth: 480 },
    { jpegQuality: 80 },
    { imageFormat: "jpeg", jpegQuality: 0 },
    { imageFormat: "jpeg", jpegQuality: 101 },
  ]) {
    assert.equal(inspectFramesSchema.safeParse(options).success, false);
  }
  assert.throws(
    () => resolvePreviewOptions(1080, 1080, { scale: 0.00001 }),
    /at least 1 pixel/,
  );
  assert.equal(exportVideoSchema.safeParse({ muted: true }).success, true);
  assert.equal(exportVideoSchema.safeParse({ muted: "yes" }).success, false);
});

test("missing sessions and unsafe export names fail before rendering", async () => {
  await assert.rejects(inspectFrames("missing"), /Call create_video first/);
  await assert.rejects(exportVideo("missing"), /Call create_video first/);
  await assert.rejects(
    exportVideo("missing", { outputName: "../../video.mp4" }),
    /filename/,
  );
});

test("session state retains source, props, metadata and compile failures", async () => {
  const project = {
    ...DEFAULT_META,
    entryFile: "/src/Video.tsx",
    files: {
      "/src/Video.tsx": "export default function Video(){return null;}",
    },
    defaultProps: { color: "red" },
    inputProps: { color: "blue" },
  };
  await compileAndRespondWithProject(project, "unit-a", [], "create_video");
  const stored = getSessionProject("unit-a")!;
  assert.ok(stored.bundle);
  assert.deepEqual(stored.inputProps, { color: "blue" });
  assert.equal(getSessionProject("unit-b"), null);
  const broken = await compileAndRespondWithProject(
    { ...project, files: { "/src/Video.tsx": "export default function {" } },
    "unit-a",
    [],
    "create_video",
  );
  assert.match(broken.content[0].text, /compilation error/i);
  assert.ok(getSessionProject("unit-a")!.compileError);
  await assert.rejects(inspectFrames("unit-a"), /Project compilation error/);
  const invalid = await compileAndRespondWithProject(
    { ...project, durationInFrames: 2.5 },
    "unit-invalid",
    [],
    "create_video",
  );
  assert.match(invalid.content[0].text, /integer/);
  assert.equal(getSessionProject("unit-invalid"), null);
});
