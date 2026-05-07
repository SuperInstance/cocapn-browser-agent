/**
 * Captain Deliberation — browser-native captain's reasoning loop
 * 
 * The captain is the expert inquiry engine. It:
 * 1. Gathers signal from all specialists (wide inquiry)
 * 2. Applies hard P0 constraints (safety, spares, trust, emergence, ZHC, time)
 * 3. Decides — or doesn't act if stable/constrained
 * 
 * This is a pure JS port of fleet-spread's captain.rs.
 * Runs entirely in the browser using the Prompt API for LLM inference.
 */

import type { FleetGraph } from '@cocapn/fleet-coordinate-js';
import { quickCheck } from '@cocapn/fleet-coordinate-js';
import { PlatoRoom, type TileSchema, type CaptainDecisionTile } from '@cocapn/plato-client';

// ---------------------------------------------------------------------------
// Hard Constraints (P0 — non-negotiable filters)
// ---------------------------------------------------------------------------

export enum HardConstraint {
  /** Safety margin must be satisfied */
  SafetyMargin = 'safety_margin',
  /** Spares must be available before acting */
  SparesRequired = 'spares_required',
  /** Trust must exceed minimum threshold */
  TrustThreshold = 'trust_threshold',
  /** Emergence must not exceed ceiling */
  EmergenceCeiling = 'emergence_ceiling',
  /** ZHC loop residual must be within tolerance */
  ZhcTolerance = 'zhc_tolerance',
  /** Action must complete within time window */
  TimeWindow = 'time_window',
}

export interface HardConstraintConfig {
  safety_margin_min?: number;
  spares_min?: number;
  trust_min?: number;
  emergence_max?: number;
  zhc_tolerance?: number;
  time_window_ms?: number;
}

export interface ConstraintViolation {
  constraint: HardConstraint;
  reason: string;
  severity: 'error' | 'warning';
}

// ---------------------------------------------------------------------------
// Inquiry — what each specialist reports
// ---------------------------------------------------------------------------

export interface SpecialistReport {
  specialist_id: string;
  signal_strength: number;  // [0, 1]
  finding: string;
  data: Record<string, unknown>;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Deliberation result
// ---------------------------------------------------------------------------

export type CaptainDecision = 
  | { kind: 'decided'; action: string; reason: string; deliberation: CaptainDeliberation }
  | { kind: 'constrained'; violations: ConstraintViolation[]; reason: string; deliberation: CaptainDeliberation }
  | { kind: 'stable'; reason: string; deliberation: CaptainDeliberation };

export interface CaptainDeliberation {
  consulted: string[];        // specialist ids
  reports: SpecialistReport[];
  fleet_state_snapshot: {
    V: number;
    E: number;
    is_rigid: boolean;
    beta_one: number;
    emergence_detected: boolean;
    zhc_consensus: boolean;
  };
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Captain class
// ---------------------------------------------------------------------------

export interface CaptainOptions {
  /** PLATO room server URL */
  platoUrl: string;
  /** Room name for this captain's deliberation tiles */
  room: string;
  /** Hard constraint configuration */
  constraints?: HardConstraintConfig;
  /** Override model adapter (Gemini Nano, DeepSeek, etc.) */
  modelAdapter?: ModelAdapter;
  /** Agent ID for tile attribution */
  agentId?: string;
}

export interface ModelAdapter {
  name: string;
  available: boolean;
  init(): Promise<boolean>;
  complete(prompt: string, context?: Record<string, unknown>): Promise<{ text: string }>;
}

/**
 * Captain — expert inquiry engine for browser-native fleet coordination.
 * 
 * Runs the full deliberation loop:
 * 1. Check fleet graph state (rigidity, emergence, ZHC)
 * 2. If stable → return Stable immediately (no inquiry needed)
 * 3. If unstable → gather specialist reports via LLM inference
 * 4. Apply P0 hard constraints
 * 5. Decide or defer
 */
export class Captain {
  private room: PlatoRoom | null = null;
  private modelAdapter: ModelAdapter | null = null;
  private constraints: HardConstraintConfig;
  private agentId: string;
  private platoUrl: string;
  private roomName: string;

  constructor(options: CaptainOptions) {
    this.platoUrl = options.platoUrl;
    this.roomName = options.room;
    this.constraints = options.constraints ?? {};
    this.agentId = options.agentId ?? 'browser-captain';
    
    if (options.modelAdapter) {
      this.modelAdapter = options.modelAdapter;
    }
  }

  async init(): Promise<void> {
    // Initialize model adapter
    if (this.modelAdapter) {
      await this.modelAdapter.init();
    }
    
    // Connect to PLATO room
    this.room = new PlatoRoom({
      url: this.platoUrl,
      room: this.roomName,
      onTile: (tile: TileSchema) => this.handleTile(tile),
    });
    
    await this.room.join();
  }

  /**
   * Run the captain's deliberation on a fleet graph.
   * 
   * @param graph - the current fleet graph state
   * @returns Captain's decision
   */
  async deliberate(graph: FleetGraph): Promise<CaptainDecision> {
    // Step 1: Check fleet state (is it stable?)
    const quick = quickCheck(graph);
    
    // Step 2: If stable, return immediately — no inquiry needed
    if (quick.is_rigid && !quick.emergence_detected) {
      const deliberation: CaptainDeliberation = {
        consulted: [],
        reports: [],
        fleet_state_snapshot: {
          V: graph.V,
          E: graph.E,
          is_rigid: quick.is_rigid,
          beta_one: quick.beta_one,
          emergence_detected: quick.emergence_detected,
          zhc_consensus: true,
        },
        timestamp: Date.now(),
      };
      
      return {
        kind: 'stable',
        reason: `Fleet is Laman-rigid (E=${graph.E}=2*${graph.V}-3=${2*graph.V-3}) with no emergence detected (β₁=${quick.beta_one}≤${quick.threshold})`,
        deliberation,
      };
    }
    
    // Step 3: Fleet is unstable — run wide inquiry
    const reports = await this.runInquiry(graph);
    
    // Step 4: Check hard constraints
    const violations = this.checkConstraints(graph, reports);
    
    // Step 5: Decide
    if (violations.length > 0) {
      const deliberation: CaptainDeliberation = {
        consulted: reports.map(r => r.specialist_id),
        reports,
        fleet_state_snapshot: {
          V: graph.V,
          E: graph.E,
          is_rigid: quick.is_rigid,
          beta_one: quick.beta_one,
          emergence_detected: quick.emergence_detected,
          zhc_consensus: quick.emergence_detected === false,
        },
        timestamp: Date.now(),
      };
      
      return {
        kind: 'constrained',
        violations,
        reason: `Hard constraint(s) violated: ${violations.map(v => v.constraint).join(', ')}`,
        deliberation,
      };
    }
    
    // Step 6: Choose action based on reports
    const action = this.chooseAction(reports, quick);
    const deliberation: CaptainDeliberation = {
      consulted: reports.map(r => r.specialist_id),
      reports,
      fleet_state_snapshot: {
        V: graph.V,
        E: graph.E,
        is_rigid: quick.is_rigid,
        beta_one: quick.beta_one,
        emergence_detected: quick.emergence_detected,
        zhc_consensus: !quick.emergence_detected,
      },
      timestamp: Date.now(),
    };
    
    return {
      kind: 'decided',
      action,
      reason: this.buildReason(quick, reports),
      deliberation,
    };
  }

  /**
   * Run wide inquiry — consult all specialists with signal.
   * Uses the LLM model adapter to generate specialist reports.
   */
  private async runInquiry(graph: FleetGraph): Promise<SpecialistReport[]> {
    const specialists = this.getSpecialists(graph);
    
    // Filter to only specialists with signal
    const activeSpecialists = specialists.filter(s => s.signal_strength > 0);
    
    if (activeSpecialists.length === 0 || !this.modelAdapter) {
      // No model adapter — use pure geometric inquiry
      return this.runGeometricInquiry(graph, activeSpecialists);
    }
    
    // Use LLM for deeper inquiry
    const prompt = this.buildInquiryPrompt(graph, activeSpecialists);
    
    try {
      const response = await this.modelAdapter.complete(prompt, {
        V: graph.V,
        E: graph.E,
        beta_one: graph.E - graph.V + 1,
        is_rigid: graph.E === 2 * graph.V - 3,
        emergence_detected: graph.E - graph.V + 1 > graph.V - 2,
      });
      
      return this.parseLLMReports(response.text, activeSpecialists);
    } catch {
      // Fall back to geometric inquiry
      return this.runGeometricInquiry(graph, activeSpecialists);
    }
  }

  /**
   * Pure geometric inquiry — no LLM needed.
   * Each specialist reports based on direct calculation.
   */
  private runGeometricInquiry(
    graph: FleetGraph,
    specialists: Array<{ id: string; signal_strength: number; topic: string }>
  ): SpecialistReport[] {
    return specialists.map(spec => {
      let finding = '';
      let data: Record<string, unknown> = {};
      
      switch (spec.topic) {
        case 'rigidity':
          finding = `Laman count: E=${graph.E}, expected ${2*graph.V-3}. ${graph.E === 2*graph.V-3 ? 'RIGID' : 'NOT RIGID'}`;
          data = { is_rigid: graph.E === 2*graph.V-3, expected_E: 2*graph.V-3 };
          break;
        case 'emergence':
          const beta = graph.E - graph.V + 1;
          finding = `β₁=${beta}, threshold=${graph.V-2}. ${beta > graph.V-2 ? 'EMERGENCE DETECTED' : 'no emergence'}`;
          data = { beta_one: beta, detected: beta > graph.V - 2, threshold: graph.V - 2 };
          break;
        case 'topology':
          finding = `V=${graph.V}, E=${graph.E}, C=${graph.C}. Average degree: ${(2*graph.E/graph.V).toFixed(2)}`;
          data = { avg_degree: 2 * graph.E / graph.V };
          break;
      }
      
      return {
        specialist_id: spec.id,
        signal_strength: spec.signal_strength,
        finding,
        data,
        timestamp: Date.now(),
      };
    });
  }

  /**
   * Get all specialists relevant to this fleet graph.
   */
  private getSpecialists(graph: FleetGraph): Array<{ id: string; signal_strength: number; topic: string }> {
    return [
      { id: 'geometric', signal_strength: 1.0, topic: 'rigidity' },
      { id: 'topological', signal_strength: graph.E > graph.V ? 0.8 : 0.3, topic: 'topology' },
      { id: 'systems', signal_strength: graph.V > 5 ? 0.7 : 0.2, topic: 'scale' },
    ];
  }

  /**
   * Check hard constraints against the current graph state.
   */
  private checkConstraints(graph: FleetGraph, reports: SpecialistReport[]): ConstraintViolation[] {
    const violations: ConstraintViolation[] = [];
    
    // Emergence ceiling
    const beta = graph.E - graph.V + 1;
    if (this.constraints.emergence_max !== undefined && beta > this.constraints.emergence_max) {
      violations.push({
        constraint: HardConstraint.EmergenceCeiling,
        reason: `β₁=${beta} exceeds ceiling ${this.constraints.emergence_max}`,
        severity: 'error',
      });
    }
    
    // Trust threshold — check average trust from reports
    const trustReports = reports.filter(r => r.data && 'trust' in r.data);
    if (trustReports.length > 0 && this.constraints.trust_min !== undefined) {
      const avgTrust = trustReports.reduce((sum, r) => sum + (Number(r.data['trust']) || 0), 0) / trustReports.length;
      if (avgTrust < this.constraints.trust_min) {
        violations.push({
          constraint: HardConstraint.TrustThreshold,
          reason: `Average trust ${avgTrust.toFixed(2)} below minimum ${this.constraints.trust_min}`,
          severity: 'error',
        });
      }
    }
    
    return violations;
  }

  /**
   * Choose the best action based on specialist reports.
   */
  private chooseAction(reports: SpecialistReport[], quick: ReturnType<typeof quickCheck>): string {
    if (quick.emergence_detected) {
      return 'investigate_emergence';
    }
    
    if (!quick.is_rigid) {
      return 'rebalance_trust_edges';
    }
    
    return 'monitor';
  }

  private buildReason(quick: ReturnType<typeof quickCheck>, reports: SpecialistReport[]): string {
    const parts: string[] = [];
    
    if (quick.is_rigid) {
      parts.push(`Laman-rigid (E=${quick.beta_one + quick.threshold}=2V-3)`);
    } else {
      parts.push(`NOT rigid (E=${quick.beta_one + quick.threshold}≠2V-3)`);
    }
    
    if (quick.emergence_detected) {
      parts.push(`EMERGENCE β₁=${quick.beta_one}>${quick.threshold}`);
    }
    
    parts.push(`${reports.length} specialist reports`);
    
    return parts.join(' | ');
  }

  private buildInquiryPrompt(
    graph: FleetGraph,
    specialists: Array<{ id: string; signal_strength: number; topic: string }>
  ): string {
    return `You are the captain of a fleet coordination system. Analyze this fleet graph:

Fleet state:
- V=${graph.V} vertices (agents)
- E=${graph.E} edges (trust connections)
- β₁ = ${graph.E - graph.V + 1} (first Betti number = independent cycles)
- ${graph.E === 2*graph.V-3 ? 'Laman-rigid' : 'NOT Laman-rigid (E≠2V-3)'}
- ${graph.E - graph.V + 1 > graph.V - 2 ? 'EMERGENCE DETECTED' : 'No emergence'}

Consult these specialists: ${specialists.map(s => s.id).join(', ')}

For each specialist, provide:
1. Their finding (one sentence)
2. Signal strength (0-1)
3. Recommended action (if any)

Format: JSON array of { specialist_id, finding, signal, action }`;
  }

  private parseLLMReports(text: string, specialists: Array<{ id: string; signal_strength: number; topic: string }>): SpecialistReport[] {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed.map((item: { specialist_id?: string; finding?: string; signal?: number; action?: string }) => ({
          specialist_id: item.specialist_id ?? 'unknown',
          signal_strength: item.signal ?? 0.5,
          finding: item.finding ?? '',
          data: { action: item.action },
          timestamp: Date.now(),
        }));
      }
    } catch {
      // Fall back to default reports
    }
    
    return specialists.map(spec => ({
      specialist_id: spec.id,
      signal_strength: spec.signal_strength,
      finding: `No LLM response — using geometric default`,
      data: {},
      timestamp: Date.now(),
    }));
  }

  private handleTile(tile: TileSchema): void {
    // Handle incoming tiles from PLATO room
    // Could update local graph state, trigger re-deliberation, etc.
  }

  /**
   * Submit a captain decision tile to PLATO.
   */
  async submitDecision(decision: CaptainDecision): Promise<void> {
    if (!this.room) throw new Error('Captain not initialized');
    
    const tile: CaptainDecisionTile = {
      type: 'captain_decision',
      timestamp: Date.now(),
      from_agent: this.agentId,
      room: this.roomName,
      data: {
        decision: decision.kind,
        reason: 'reason' in decision ? decision.reason : '',
        consulted: decision.deliberation.consulted,
        action_taken: decision.kind === 'decided' ? decision.action : undefined,
        violations: decision.kind === 'constrained' ? decision.violations.map(v => v.constraint) : undefined,
      },
    };
    
    await this.room.submitTile(tile);
  }

  async leave(): Promise<void> {
    if (this.room) {
      await this.room.leave();
    }
  }
}