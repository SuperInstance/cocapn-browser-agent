/**
 * Gemini Nano Adapter — Chrome Built-in AI via Prompt API
 * 
 * Wraps Chrome's built-in Prompt API (LanguageModel) as an inference backend.
 * Uses navigator.ai.gemini — available in Chrome 148+ (Prompt API stable).
 * Zero network calls when Gemini Nano is available.
 * Falls back to cloud APIs when unavailable.
 * 
 * Hardware requirements (Chrome built-in AI):
 * - Windows 10+, macOS 13+, Linux, ChromeOS (Chromebook Plus)
 * - 22GB+ free storage (model is ~4GB)
 * - GPU with 4GB+ VRAM OR CPU with 16GB+ RAM + 4 cores
 */

export interface AIModelResponse {
  text: string;
  finishReason?: 'stop' | 'max_tokens' | 'unknown';
}

/** Chrome built-in AI availability result */
interface AvailabilityResult {
  readonly state: 'available' | 'downloading' | 'updating' | 'no-model' | 'unsupported';
}

/** Chrome's built-in LanguageModel (Prompt API) — extend global to avoid TS errors */
declare global {
  interface Navigator {
    ai?: {
      gemini?: {
        readonly availability: () => Promise<AvailabilityResult>;
        readonly create: (options?: LanguageModelCreateOptions) => Promise<LanguageModelSession>;
      };
    };
  }
}

interface LanguageModelCreateOptions {
  systemPrompt?: string;
  temperature?: number;
  topK?: number;
  signal?: AbortSignal;
}

interface LanguageModelSession {
  prompt(text: string, options?: { context?: string }): Promise<string>;
  promptStreaming(text: string): ReadableStream<string>;
  destroy(): void;
}

/**
 * Check if Chrome's built-in AI (Prompt API) is available.
 * 
 * Checks navigator.ai.gemini.availability() — returns 'available' when
 * Gemini Nano is downloaded and ready, 'downloading' during initial download,
 * 'no-model' when not downloaded, 'unsupported' when hardware doesn't support it.
 */
export async function isGeminiNanoAvailable(): Promise<{
  available: boolean;
  state: AvailabilityResult['state'];
}> {
  if (typeof navigator === 'undefined' || !navigator.ai?.gemini) {
    return { available: false, state: 'unsupported' };
  }

  try {
    const result = await navigator.ai.gemini.availability();
    return {
      available: result.state === 'available',
      state: result.state,
    };
  } catch {
    return { available: false, state: 'unsupported' };
  }
}

/**
 * Create a model adapter that uses Gemini Nano via Prompt API.
 * 
 * Usage:
 *   const adapter = createGeminiNanoAdapter({
 *     onUnavailable: () => useCloudFallback(),
 *   });
 *   await adapter.init();
 *   const response = await adapter.complete("Analyze this fleet graph...");
 */
export function createGeminiNanoAdapter(options?: {
  onUnavailable?: () => void;
  systemPrompt?: string;
}): ModelAdapter {
  let session: LanguageModelSession | null = null;

  return {
    name: 'gemini-nano',
    available: false,
    downloaded: false,

    async init(): Promise<boolean> {
      const { available, state } = await isGeminiNanoAvailable();

      if (state === 'downloading' || state === 'updating') {
        options?.onUnavailable?.();
        return false;
      }

      if (!available) {
        options?.onUnavailable?.();
        return false;
      }

      try {
        const createOptions: LanguageModelCreateOptions = {};
        
        if (options?.systemPrompt) {
          createOptions.systemPrompt = options.systemPrompt;
        }

        session = await navigator.ai!.gemini!.create(createOptions);
        this.available = true;
        this.downloaded = true;
        return true;
      } catch {
        options?.onUnavailable?.();
        return false;
      }
    },

    async complete(prompt: string, context?: Record<string, unknown>): Promise<AIModelResponse> {
      if (!session) {
        throw new Error('Gemini Nano session not initialized — call init() first');
      }

      // Build context string from extra context
      let fullPrompt = prompt;
      if (context && Object.keys(context).length > 0) {
        const contextParts = Object.entries(context)
          .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
          .join('\n');
        fullPrompt = `Context:\n${contextParts}\n\n${prompt}`;
      }

      try {
        const text = await session.prompt(fullPrompt);
        return { text, finishReason: 'stop' };
      } catch (err) {
        // Session may have been invalidated — try to recreate
        if (session) {
          session.destroy();
          session = null;
          this.available = false;
        }
        options?.onUnavailable?.();
        throw err;
      }
    },

    destroy(): void {
      if (session) {
        session.destroy();
        session = null;
      }
    },
  };
}

/**
 * Generic model adapter interface.
 * Both Gemini Nano and cloud adapters implement this.
 */
export interface ModelAdapter {
  name: string;
  available: boolean;
  downloaded?: boolean;  // true when model is locally available (Gemini Nano)
  init(): Promise<boolean>;
  complete(prompt: string, context?: Record<string, unknown>): Promise<AIModelResponse>;
  destroy?(): void;
}

/**
 * Cloud fallback adapter — routes to DeepSeek or z.ai GLM.
 * User provides their own API key, or we use our fleet's key.
 */
export function createCloudFallbackAdapter(config: {
  provider: 'deepseek' | 'zai';
  apiKey?: string;
  model?: string;
}): ModelAdapter {
  return {
    name: `cloud-${config.provider}`,
    available: true,

    async init(): Promise<boolean> {
      return true;
    },

    async complete(prompt: string, context?: Record<string, unknown>): Promise<AIModelResponse> {
      const model = config.model ?? (config.provider === 'deepseek' ? 'deepseek-chat' : 'glm-5');

      if (config.provider === 'deepseek') {
        return completeDeepSeek(prompt, model, config.apiKey);
      } else {
        return completeZai(prompt, model, config.apiKey);
      }
    },
  };
}

async function completeDeepSeek(
  prompt: string,
  model: string,
  apiKey?: string
): Promise<AIModelResponse> {
  const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey ?? ''}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1000,
    }),
  });

  if (!res.ok) {
    throw new Error(`DeepSeek API error: ${res.status}`);
  }

  const json = await res.json() as {
    choices: Array<{ message: { content: string }; finish_reason: string }>;
  };

  return {
    text: json.choices[0]?.message?.content ?? '',
    finishReason: json.choices[0]?.finish_reason as 'stop' | 'max_tokens' | 'unknown' ?? 'unknown',
  };
}

async function completeZai(
  prompt: string,
  model: string,
  apiKey?: string
): Promise<AIModelResponse> {
  const res = await fetch('https://z.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey ?? ''}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1000,
    }),
  });

  if (!res.ok) {
    throw new Error(`z.ai API error: ${res.status}`);
  }

  const json = await res.json() as {
    choices: Array<{ message: { content: string }; finish_reason: string }>;
  };

  return {
    text: json.choices[0]?.message?.content ?? '',
    finishReason: json.choices[0]?.finish_reason as 'stop' | 'max_tokens' | 'unknown' ?? 'unknown',
  };
}

/**
 * Auto-select adapter: try Gemini Nano first, fall back to cloud.
 */
export async function createAutoAdapter(
  cloudConfig?: { provider: 'deepseek' | 'zai'; apiKey?: string; model?: string }
): Promise<ModelAdapter> {
  const { available, state } = await isGeminiNanoAvailable();

  if (available) {
    return createGeminiNanoAdapter();
  }

  if (state === 'downloading') {
    console.info('[Agent] Gemini Nano downloading in background, falling back to cloud');
  }

  if (cloudConfig) {
    return createCloudFallbackAdapter(cloudConfig);
  }

  throw new Error('No AI backend available and no cloud config provided');
}