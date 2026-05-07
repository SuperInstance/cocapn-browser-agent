# @cocapn/cocapn-browser-agent

**Browser-native fleet agent using Chrome's built-in Gemini Nano AI. Zero-install fleet coordination.**

Open `cocapn.ai` in Chrome and the agent is already running — using Gemini Nano, no API key needed, no server required for the AI layer.

---

## Quick Start

```bash
npm install @cocapn/cocapn-browser-agent
```

```js
import { Captain, createAutoAdapter } from '@cocapn/cocapn-browser-agent';
import { buildFleetGraph } from '@cocapn/fleet-coordinate-js';

const captain = new Captain({
  platoUrl: 'http://localhost:8847',  // or your PLATO server
  room: 'fleet_communication',
});

await captain.init();

// Fleet graph — agents and trust edges
const graph = buildFleetGraph(
  [{ id: 'alice' }, { id: 'bob' }, { id: 'carol' }],
  [
    { from: 'alice', to: 'bob', trust: 0.85 },
    { from: 'bob', to: 'carol', trust: 0.72 },
    { from: 'carol', to: 'alice', trust: 0.91 },
  ]
);

const decision = await captain.deliberate(graph);
console.log(decision);
// { kind: 'stable', reason: 'Fleet is Laman-rigid...', ... }
// or { kind: 'decided', action: 'investigate_emergence', ... }
// or { kind: 'constrained', violations: [...], ... }
```

---

## How It Works

**The captain's loop:**
1. Check fleet graph state — Laman rigidity (E = 2V - 3), H¹ emergence (β₁ > V - 2)
2. If stable → return immediately (no AI needed, pure math)
3. If unstable → run wide inquiry (consult specialists with signal)
4. Apply P0 hard constraints (safety, spares, trust threshold, emergence ceiling, ZHC tolerance, time window)
5. Decide, constrain, or defer

**AI layer — three tiers:**
1. **Chrome built-in (Gemini Nano)** — `navigator.ai.gemini` via Prompt API, runs locally, zero cost
2. **DeepSeek API** — user provides their own key, or fleet key for open use cases
3. **z.ai GLM** — fleet's paid GLM-5 model for heavy reasoning

The agent auto-selects the best available backend. No configuration needed for the happy path.

---

## Visual Layer — PodiumJS (WebGPU)

Dashboard visualization uses **[PodiumJS](https://github.com/vdmo/podiumjs-rocks)** by [@vdmo](https://github.com/vdmo) — a modern WebGPU alternative to Curtains.js for interactive planes and visual effects. Agent activity (trust updates, emergence events, ZHC consensus states) rendered as animated 3D planes with custom shaders.

We use PodiumJS as-is from npm. Our agent code composes on top of it.

> **vdmo integration:** PodiumJS used under MIT license. We thank [@vdmo](https://github.com/vdmo) for building and sharing this — it maps directly to our fleet visualization needs. The full source is at [github.com/vdmo/podiumjs-rocks](https://github.com/vdmo/podiumjs-rocks).

---

## Architecture

```
Chrome (Gemini Nano)
    ↓ Prompt API (navigator.ai.gemini)
Browser Agent (@cocapn/cocapn-browser-agent)
    ↓ fetch (PLATO tiles)
PLATO Room Server (localhost:8847 or hosted)
    ↓
Fleet Coordinate (Laman rigidity, H1, ZHC, Pythagorean48)
    ↓
Git-native agents (fleet-coordinate-js handles all geometric math in pure JS)
```

**No WASM.** The fleet-coordinate geometric math runs in pure TypeScript — Laman rigidity is one line, H¹ is one line, Pythagorean48 is array indexing. No Rust, no Emscripten, no binary compatibility issues.

---

## Key Modules

| Module | What it does |
|--------|-------------|
| `Captain` | Captain deliberation loop — wide inquiry + P0 constraints + decide/constrain/stable |
| `GeminiNanoAdapter` | Wraps `navigator.ai.gemini` (Prompt API) as an inference backend |
| `CloudFallbackAdapter` | DeepSeek / z.ai GLM fallback when Gemini Nano unavailable |
| `PlatoBridge` | Submits captain decision tiles to PLATO rooms |

---

## Hardware Requirements

**For Chrome built-in AI (Gemini Nano):**
- OS: Windows 10+, macOS 13+ (Ventura), Linux, ChromeOS (Chromebook Plus)
- Storage: 22GB+ free space (~4GB model download)
- GPU: 4GB+ VRAM, OR CPU: 16GB+ RAM + 4+ cores

**Without built-in AI:** Falls back to cloud API (DeepSeek or z.ai) — no hardware requirements.

---

## PLATO Integration

The captain submits decision tiles to PLATO rooms. Other fleet agents see the decisions and react. The PLATO server is the shared memory layer for the entire fleet.

```js
const captain = new Captain({
  platoUrl: 'https://plato.cocapn.ai',  // or localhost
  room: 'fleet_communication',
  agentId: 'browser-alice-001',
});

await captain.init();

// After deliberation, the captain submits tiles automatically
const decision = await captain.deliberate(graph);
await captain.submitDecision(decision);  // → PLATO room
```

---

## Related Packages

| Package | What it does |
|---------|-------------|
| [`@cocapn/fleet-coordinate-js`](https://github.com/SuperInstance/fleet-coordinate-js) | Pure JS Laman rigidity, H¹, ZHC, Pythagorean48 |
| [`@cocapn/plato-client`](https://github.com/SuperInstance/plato-client-js) | PLATO room protocol client, Node + browser |

---

## License

MIT

**Third-party acknowledgments:**
- **PodiumJS** by [@vdmo](https://github.com/vdmo) — MIT License, used for WebGPU visual effects in dashboard integration
- **Gemini Nano** — Google Chrome built-in AI, no separate license required