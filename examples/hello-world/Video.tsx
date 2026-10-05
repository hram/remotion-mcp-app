import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

export default function HelloWorld() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const time = frame / fps;
  const entrance = spring({ frame: frame - 8, fps, config: { damping: 22, stiffness: 85 } });
  const second = spring({ frame: frame - 20, fps, config: { damping: 22, stiffness: 85 } });
  const reveal = interpolate(frame, [0, 24], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const orbit = time * 0.22;

  return <AbsoluteFill style={{ background: "#06141b", color: "#f6f4e9", overflow: "hidden", fontFamily: "Arial, sans-serif" }}>
    <AbsoluteFill style={{ background: `radial-gradient(ellipse at ${30 + Math.sin(time * .5) * 8}% 76%, #146b6755 0%, transparent 56%), radial-gradient(ellipse at 78% ${25 + Math.cos(time * .4) * 10}%, #13444c99 0%, transparent 50%), linear-gradient(120deg, #031018, #0b242a 65%, #09151e)` }} />
    <svg width="1920" height="1080" viewBox="0 0 1920 1080" style={{ position: "absolute", inset: 0 }}>
      <defs>
        <linearGradient id="aurora" x1="0" y1="1" x2="1" y2="0">
          <stop stopColor="#4bffe1" stopOpacity="0" /><stop offset=".42" stopColor="#48e6b6" stopOpacity=".7" /><stop offset=".72" stopColor="#a9f9e5" stopOpacity=".65" /><stop offset="1" stopColor="#f6b978" stopOpacity="0" />
        </linearGradient>
        <filter id="glow"><feGaussianBlur stdDeviation="40" /></filter>
        <radialGradient id="planet"><stop stopColor="#fff1cc" /><stop offset=".32" stopColor="#ffd59a" /><stop offset="1" stopColor="#f08757" /></radialGradient>
      </defs>
      <g transform={`translate(0 ${Math.sin(time * .65) * 35})`} opacity={.8 * reveal}>
        <path d="M-180 980 C350 1160 330 380 1000 540 S1530 950 2100 -140" fill="none" stroke="url(#aurora)" strokeWidth="180" filter="url(#glow)" />
        <path d="M-180 980 C350 1160 330 380 1000 540 S1530 950 2100 -140" fill="none" stroke="url(#aurora)" strokeWidth="2" opacity=".35" />
      </g>
      <g transform={`translate(960 540) rotate(${-24 + Math.sin(time * .3) * 4})`} fill="none" stroke="#a4d8cc">
        <ellipse rx="730" ry="370" strokeOpacity=".17" />
        <ellipse rx="810" ry="410" strokeOpacity=".07" />
        <ellipse rx="650" ry="330" strokeOpacity=".06" />
        <circle cx={730 * Math.cos(orbit - .9)} cy={370 * Math.sin(orbit - .9)} r="17" fill="url(#planet)" stroke="none" />
        <circle cx={730 * Math.cos(orbit - .9)} cy={370 * Math.sin(orbit - .9)} r="40" fill="#ffbf80" fillOpacity=".13" stroke="none" />
      </g>
      {Array.from({ length: 70 }, (_, i) => {
        const x = (i * 347 + 89) % 1920;
        const y = ((i * 223 + 61) % 1080) + Math.sin(time * .4 + i) * 7;
        return <circle key={i} cx={x} cy={y} r={i % 5 === 0 ? 2 : 1} fill="#d2efe4" opacity={(.18 + .24 * (1 + Math.sin(time + i * 1.7)) / 2) * reveal} />;
      })}
    </svg>
    <div style={{ position: "absolute", left: 90, top: 66, display: "flex", gap: 16, alignItems: "center", opacity: reveal }}>
      <div style={{ width: 8, height: 8, background: "#9ce8cd", borderRadius: "50%", boxShadow: "0 0 22px #9ce8cd" }} />
      <span style={{ fontSize: 15, letterSpacing: 5, color: "#b3c9c6" }}>A NEW BEGINNING</span>
    </div>
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", paddingBottom: 35 }}>
      <div style={{ fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 112, letterSpacing: -5, lineHeight: 1.1, opacity: entrance, transform: `translateY(${(1 - entrance) * 45}px)`, textShadow: "0 4px 40px #03101566" }}>Hello</div>
      <div style={{ fontSize: 220, fontWeight: 700, letterSpacing: -13, lineHeight: 1.05, opacity: second, transform: `translateY(${(1 - second) * 60}px) scale(${.97 + second * .03})`, textShadow: "0 8px 60px #03101555" }}>World<span style={{ color: "#b9efd7" }}>.</span></div>
      <div style={{ marginTop: 35, display: "flex", alignItems: "center", gap: 22, opacity: interpolate(frame, [36, 66], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
        <span style={{ width: 40, height: 1, background: "#91bcb2" }} />
        <span style={{ fontSize: 17, letterSpacing: 6, color: "#bfcec7" }}>SMALL WORDS. INFINITE POSSIBILITIES.</span>
        <span style={{ width: 40, height: 1, background: "#91bcb2" }} />
      </div>
    </AbsoluteFill>
    <div style={{ position: "absolute", bottom: 66, left: 90, right: 90, display: "flex", justifyContent: "space-between", color: "#87a7a2", fontSize: 13, letterSpacing: 3, opacity: reveal }}><span>01 / HELLO WORLD</span><span>MADE OF MOTION</span></div>
  </AbsoluteFill>;
}
