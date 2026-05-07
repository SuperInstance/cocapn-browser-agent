/**
 * @cocapn/browser-agent — Browser-native fleet agent using Chrome's built-in AI
 * 
 * Zero-install fleet coordination for any Chrome user.
 * Uses Gemini Nano via Prompt API when available.
 * Falls back to cloud APIs (DeepSeek, z.ai GLM) otherwise.
 * 
 * Usage:
 *   import { Captain } from '@cocapn/browser-agent';
 *   
 *   const captain = new Captain({
 *     platoUrl: 'http://localhost:8847',
 *     room: 'fleet_communication',
 *   });
 *   
 *   await captain.init();
 *   const decision = await captain.deliberate(fleetGraph);
 */

export { Captain } from './captain.js';
export type { CaptainOptions, CaptainDecision, HardConstraintConfig, ConstraintViolation, CaptainDeliberation, SpecialistReport } from './captain.js';
export { createGeminiNanoAdapter, isGeminiNanoAvailable, createAutoAdapter } from './model_adapters.js';
export type { ModelAdapter, AIModelResponse } from './model_adapters.js';