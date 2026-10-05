import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";

const palette = { bg: "#0b1014", card: "#151e25", border: "#2b3943", ink: "#f3f6f7", muted: "#8b9aa5", green: "#a3e78c", red: "#ff827f" };
const clamp = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };

// A frame-driven illustration of the Android UI feedback loop, not a live Android render.
export default function AndroidUiRenderer() {
  const frame = useCurrentFrame();
  const resetting = frame >= 192;
  const phase = resetting ? 0 : frame < 48 ? 0 : frame < 84 ? 1 : frame < 126 ? 2 : 3;
  const reset = interpolate(frame, [192, 208], [1, 0], clamp);
  const fixed = interpolate(frame, [126, 153], [0, 1], clamp) * reset;
  const checked = phase >= 2;
  const buttonY = 270 + fixed * 88;
  const accent = phase === 2 ? palette.red : palette.green;
  const codeLines = [
    "Column(",
    `  Modifier.padding(${fixed > .5 ? "24" : "8"}.dp)`,
    ") {",
    "  TextField(name)",
    `  Spacer(${fixed > .5 ? "24" : "8"}.dp)`,
    "  Button { Text(\"Create\") }",
    "}",
  ];
  return <AbsoluteFill style={{ background: palette.bg, color: palette.ink, fontFamily: "Arial, sans-serif", overflow: "hidden" }}>
    <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(#3c4b5544 1px, transparent 1px)", backgroundSize: "32px 32px", opacity: .32 }} />
    <div style={{ position: "absolute", inset: 0 }}>
      <div style={{ position: "absolute", left: 100, top: 64, fontSize: 80, fontWeight: 700, letterSpacing: -3 }}>Android UI Renderer <span style={{ color: palette.green }}>MCP</span></div>
      <div style={{ position: "absolute", left: 103, top: 166, fontSize: 36, color: "#b1bfc8" }}>AI writes code. Sees the UI. Fixes the layout.</div>
      <div style={{ position: "absolute", left: 100, top: 270, width: 900, height: 550, background: palette.card, border: `1px solid ${palette.border}`, borderRadius: 24, overflow: "hidden" }}>
        <div style={{ height: 70, padding: "0 32px", display: "flex", alignItems: "center", gap: 13, borderBottom: `1px solid ${palette.border}`, fontSize: 30, color: palette.muted }}><span style={{ width: 10, height: 10, background: palette.green, borderRadius: 10 }} />ProjectForm.kt<span style={{ marginLeft: "auto", fontSize: 24, letterSpacing: 3 }}>AI AGENT</span></div>
        <div style={{ padding: "25px 30px", fontFamily: "monospace", fontSize: 40, lineHeight: "56px" }}>
          {codeLines.map((line, index) => <div key={index} style={{ display: "flex", gap: 25, color: index === 1 || index === 4 ? (fixed > .5 ? palette.green : palette.red) : "#c6d4dc", background: index === 1 || index === 4 ? "#a3e78c09" : undefined }}><span style={{ color: "#6b8292", width: 30, textAlign: "right" }}>{index + 1}</span><span style={{ whiteSpace: "pre" }}>{line}</span></div>)}
        </div>
      </div>
      <svg width="260" height="500" style={{ position: "absolute", left: 1030, top: 315 }} viewBox="0 0 260 500">
        <path d="M20 160 H230 l-18 -14 M230 160 l-18 14" fill="none" stroke={phase >= 1 ? palette.green : "#3a4b57"} strokeWidth="3" />
        <path d="M230 350 H20 l18 -14 M20 350 l18 14" fill="none" stroke={phase >= 2 ? accent : "#3a4b57"} strokeWidth="3" />
        {phase === 1 && <circle cx={interpolate(frame, [48, 83], [20, 230], clamp)} cy="160" r="7" fill={palette.green} />}
        {phase === 2 && <circle cx={interpolate(frame, [84, 125], [230, 20], clamp)} cy="350" r="7" fill={palette.red} />}
        <text x="130" y="136" textAnchor="middle" fill={palette.muted} fontSize="30" fontFamily="Arial">RENDER</text>
        <text x="130" y="388" textAnchor="middle" fill={accent} fontSize="30" fontFamily="Arial">{phase === 2 ? "ISSUE FOUND" : phase === 3 ? (fixed > .9 ? "VERIFIED" : "FIXING…") : "OBSERVE"}</text>
      </svg>
      <div style={{ position: "absolute", left: 1300, top: 240, width: 500, height: 620, borderRadius: 42, padding: 12, background: "#24323c", border: `1px solid ${palette.border}` }}>
        <div style={{ position: "absolute", inset: 12, borderRadius: 32, background: "#f3f5f0", color: "#19281d", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 20, left: 25, right: 25, display: "flex", justifyContent: "space-between", fontSize: 15 }}><span>9:41</span><span>● ▰</span></div>
          <div style={{ position: "absolute", top: 68, left: 28, width: 48, height: 48, borderRadius: 15, background: "#d8e9cf", display: "grid", placeItems: "center", fontSize: 30 }}>+</div>
          <div style={{ position: "absolute", top: 135, left: 28, fontSize: 42, fontWeight: 700, letterSpacing: -1 }}>New project</div>
          <div style={{ position: "absolute", top: 190, left: 28, fontSize: 28, color: "#697767" }}>Project name</div>
          <div style={{ position: "absolute", top: 230, left: 28, right: 28, height: 70, border: "2px solid #c4cec0", borderRadius: 13, display: "flex", alignItems: "center", paddingLeft: 20, fontSize: 34 }}>Demo app</div>
          <div style={{ position: "absolute", top: 315, left: 30, fontSize: 26, color: "#687365" }}>Only letters and numbers</div>
          <div style={{ position: "absolute", top: buttonY, left: 28, right: 28, height: 70, borderRadius: 16, background: "#244a28", color: "#f0f7e8", display: "grid", placeItems: "center", fontSize: 34, fontWeight: 700 }}>Create project</div>
          {checked && <div style={{ position: "absolute", top: buttonY - 6, left: 22, right: 22, height: 82, border: `3px solid ${fixed > .9 ? "#549948" : "#db5350"}`, borderRadius: 20 }} />}
          {checked && <div style={{ position: "absolute", bottom: 42, left: 28, right: 28, padding: "14px 12px", background: fixed > .9 ? "#e1edda" : phase === 3 ? "#e6e9e1" : "#f5e1dc", borderRadius: 12, color: fixed > .9 ? "#3c7535" : phase === 3 ? "#516447" : "#b13b37", fontSize: 28, textAlign: "center", fontWeight: 700 }}>{fixed > .9 ? "✓ Layout check passed" : phase === 3 ? "Checking the fix…" : "! Overlapping elements"}</div>}
        </div>
      </div>
      <div style={{ position: "absolute", left: 100, right: 100, top: 920, display: "flex", gap: 18 }}>
        {["CODE", "RENDER", "INSPECT", "FIX"].map((label, index) => <div key={label} style={{ flex: 1, borderRadius: 14, border: `1px solid ${index === phase ? accent : palette.border}`, background: index === phase ? "#a3e78c10" : "#10181e", height: 78, display: "flex", alignItems: "center", gap: 16, paddingLeft: 24, fontSize: 36, letterSpacing: 2, color: index === phase ? accent : palette.muted }}><span style={{ fontSize: 24, opacity: .7 }}>0{index + 1}</span>{label}<span style={{ marginLeft: "auto", marginRight: 22, opacity: .6 }}>{index < 3 ? "→" : "↺"}</span></div>)}
      </div>
    </div>
  </AbsoluteFill>;
}
