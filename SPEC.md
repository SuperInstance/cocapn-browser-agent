# Cocapn Browser Agent + Web Apps

## Context

Chrome now ships Gemini Nano as a built-in AI model (~4GB, downloaded automatically on capable hardware). The Prompt API, Summarizer API, Writer API, Translator API are all available in Chrome 126+ with no server infrastructure needed. This means our git-native agents and PLATO systems can run directly in the browser — zero install, zero backend for the AI layer.

vdmo (GitHub: vdmo) builds visual/web tools: **PodiumJS** (WebGPU alternative to Curtains.js), **lesssgo** (browser VJ mixer), **cms reset api**. Their vibe is "keeping it live and interactive, research in visual and web." We can use their tech as the visual layer for our agent systems.

---

## What We're Building

### 1. `@cocapn/browser-agent` — Agent that just works in Chrome

An npm package that any web app imports. It detects Chrome's built-in AI (navigator.ai) and wires it directly into our git-native agent architecture.

```bash
npm install @cocapn/browser-agent
```

```js
import { CocapnAgent } from '@cocapn/browser-agent';

const agent = new CocapnAgent({
  model: 'gemini-nano',  // uses Chrome's built-in, no API key needed
  personality: 'captain'
});

// Captain deliberation using Prompt API + fleet-coordinate bridge
const decision = await agent.deliberate(fleetState);
```

**What it does:**
- Detects Chrome built-in AI via `navigator.ai.gemini?.ready`
- Uses Prompt API for the inference layer (no API calls to external servers)
- PLATO tiles submitted via `fetch()` to our existing PLATO room server
- fleet-coordinate math runs client-side in JavaScript (no Rust needed in browser)
- Falls back to cloud API (DeepSeek, z.ai) when Chrome AI unavailable

**Key insight:** The captain deliberation loop doesn't need a server. The Prompt API handles the LLM piece. PLATO handles the memory layer (fetch to our server). fleet-coordinate handles the geometric reasoning (pure JS, no WASM needed for the math).

### 2. `cocapn.ai/web` upgrade — Visual Web Apps

Upgrade our existing `cocapn.ai` (PHP, currently at `repos/cocapn.ai/`) to use:
- **PodiumJS** (vdmo's WebGPU library) — for live visual effects on the dashboard
- **lesssgo** concepts — live video/GIF mixing for agent activity visualization
- Real-time PLATO tile stream rendered as animated trust graphs

**Architecture:**
```
Chrome (Gemini Nano)
    ↓ Prompt API
Browser Agent (@cocapn/browser-agent)
    ↓ fetch (PLATO tiles)
PLATO Room Server (localhost:8847 or hosted)
    ↓
Fleet Coordinate + fleet-spread (captain)
    ↓
Git-native agents (git-agent, greenhorn, etc.)
```

### 3. PLATO Browser Client — `@cocapn/plato-client`

Pure JS library that speaks the PLATO room protocol. No Rust, no WASM — just fetch and JSON.

```js
import { PlatoClient } from '@cocapn/plato-client';

const plato = new PlatoClient({ room: 'fleet_communication' });
await plato.join();
plato.onTile(tile => console.log(tile));
await plato.submitTile({ type: 'trust', data: { from: 'a', to: 'b', value: 0.7 } });
```

### 4. fleet-coordinate Pure JS Port

The geometric math (Laman rigidity, H¹ cohomology, Pythagorean48, ZHC) ported to TypeScript for browser use. No Rust dependency. This is the "captain's mind" in the browser.

```ts
// Laman rigidity check (E = 2V - 3)
function isLamanRigid(V: number, E: number): boolean {
  return E === 2 * V - 3;
}

// H¹ beta-1 = E - V + 1
function betaOne(V: number, E: number, C: number = 1): number {
  return E - V + C;
}
```

---

## What vdmo Tech We Use

### PodiumJS (WebGPU planes)

Live visual effects for the agent dashboard. Agent activity (tile submissions, trust updates, fleet state changes) rendered as animated 3D planes with WebGPU shaders.

```js
import { Podium } from 'podiumjs';

const podium = new Podium({ canvas: document.querySelector('#viz'), backgroundColor: [0.02, 0.04, 0.08, 1] });
await podium.initialize();

// Agent activity = animated plane with custom uniforms
await podium.createUniformPlane('agent-1', 'trust-gradient.png');
podium.updateUniforms('agent-1', {
  activityLevel: 0.7,
  trustValue: 0.85,
  timestamp: performance.now() / 1000
});
```

**Why:** WebGPU is the modern replacement for WebGL. vdmo's PodiumJS is the cleanest WebGPU library for this use case. It's on npm (`podiumjs`), TypeScript-first.

### lesssgo (VJ Mixer concepts)

Live mixing of agent activity feeds — video, GIF, procedural visuals. Agent events could trigger visual "beats" in a mixer-style UI. Good for the fleet monitoring dashboard.

---

## Implementation Plan

### Phase 1: Core Infrastructure (this session)

**`@cocapn/browser-agent`** — Agent class with:
- `GeminiNanoAdapter` — wraps Prompt API, detects availability
- `CloudFallbackAdapter` — DeepSeek / z.ai when nano unavailable
- `PlatoBridge` — submits tiles to PLATO room server
- `FleetCoordinateJS` — pure JS Laman/H1/Pythagorean48
- `CaptainDeliberation` — full deliberation loop in browser

**`@cocapn/plato-client`** — PLATO room protocol client:
- `PlatoRoom` class — join room, send/receive tiles
- `TileSchema` — typed tiles (trust, emergence, zhc, etc.)
- Works in Node.js AND browser

**`plato-client-php` upgrade** — existing PHP client at `repos/plato-client-php/` needs npm counterpart for JS-first web apps.

### Phase 2: Web Apps (next session)

**`cocapn.ai` upgrade:**
- Replace static dashboard with live PodiumJS visualization
- Agent activity as animated WebGPU planes
- Real-time PLATO tile feed via WebSocket or polling

**vdmo integration:**
- `podiumjs` via npm for WebGPU effects
- Design language from lesssgo (dark, neon, VJ aesthetic)

### Phase 3: Deep R&D (following sessions)

**Agentic browsing features:**
- Tab-aware agent that can read page content (Summarizer API)
- Form-filling agent using Prompt API
- Multi-tab fleet coordination via Chrome extension

**Git-native in browser:**
- Pure JS git implementation (no native code)
- Agent commits, branches, PRs from browser tab

---

## Technical Decisions

**No WASM for browser** — fleet-coordinate math is simple enough to port to pure JS. The Laman rigidity formula is one line. H¹ is one line. Pythagorean48 is array indexing. ZHC is the only complex part and we can simplify it for the browser use case.

**Zero server for AI** — Prompt API means the AI layer costs us nothing at runtime. We only need our PLATO server for the memory/coordination layer.

**Fallback chain:**
1. Chrome built-in (Gemini Nano) via Prompt API — free, local, no network
2. DeepSeek API (user provides key or we bill) — cloud inference
3. z.ai GLM — via OpenClaw if running in our environment

**Package structure:**
```
@cocapn/browser-agent/     → npm package
@cocapn/plato-client/      → npm package (works Node + browser)
@cocapn/fleet-coordinate-js/ → npm package (pure TS, no Rust)
```

**vdmo integration via npm, not fork** — we use their packages as-is from npm. We build on top of PodiumJS, not fork it.

---

## What This Enables

**For end users:** Install nothing. Open Chrome. Go to `cocapn.ai`. The agent just works, using Gemini Nano, with full fleet coordination via PLATO. Zero setup.

**For developers:** `npm install @cocapn/browser-agent` and get a captain agent with:
- Built-in deliberation (Prompt API, no server)
- PLATO tile submission
- fleet-coordinate geometric reasoning
- cloud fallback when Chrome AI unavailable

**The dojo model in browser:** A greenhorn opens cocapn.ai, the agent is already there, already running, already coordinating with the fleet. No install. No CLI. No server management. Just works.

---

## Dependencies (npm)

```json
{
  "@cocapn/browser-agent": "file:../cocapn-browser-agent",
  "@cocapn/plato-client": "file:../plato-client-js",
  "@cocapn/fleet-coordinate-js": "file:../fleet-coordinate-js",
  "podiumjs": "^1.0.0"
}
```

All vdmo tech via public npm — we don't fork, we build on top.