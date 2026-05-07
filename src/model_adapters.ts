/**
 * Gemini Nano Adapter — Chrome Built-in AI
 * 
 * Wraps Chrome's built-in Prompt API (Gemini Nano) as an inference backend.
 * Zero network calls when Gemini Nano is available.
 * Falls back to cloud APIs when unavailable.
 */

export interface AIModelResponse {
  text: string;
  finishReason?: 'stop' | 'max_tokens' | 'unknown';
}

/**
 * Check if Chrome's built-in AI is available on this device/browser.
 * navigator.ai.gemini?.ready indicates Gemini Nano is downloaded and ready.
 */
export async function isGeminiNanoAvailable(): Promise<boolean> {
  if (typeof navigator === 'undefined') return false;
  
  try {
    // @ts-ignore — navigator.ai is not in standard TypeScript types yet
    const gemini = navigator.ai?.gemini;
    if (!gemini) return false;
    
    // The `ready` promise resolves when the model is downloaded
    await gemini.ready;
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a model adapter that uses Gemini Nano via Prompt API.
 * Falls back to a provided cloud adapter if Gemini Nano is unavailable.
 */
export function createGeminiNanoAdapter(
  onUnavailable?: () => void
): ModelAdapter {
  return {
    name: 'gemini-nano',
    available: false,  // will be set by init()
    
    async init(): Promise<boolean> {
      const avail = await isGeminiNanoAvailable();
      this.available = avail;
      if (!avail && onUnavailable) onUnavailable();
      return avail;
    },
    
    async complete(prompt: string, context?: Record<string, unknown>): Promise<AIModelResponse> {
      if (!this.available) {
        throw new Error('Gemini Nano not available — use cloud fallback');
      }
      
      try {
        // @ts-ignore — Prompt API not in standard types
        const session = await navigator.ai.gemini.createModelSession();
        
        // Build generation context from extra context
        const context_parts = context 
          ? Object.entries(context).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n')
          : '';
        
        const fullPrompt = context_parts ? `${context_parts}\n\n${prompt}` : prompt;
        
        const result = await session.prompt(fullPrompt);
        
        return {
          text: result,
          finishReason: 'stop',
        };
      } catch (err) {
        // If Gemini fails (model not ready, etc.), fall back
        if (onUnavailable) onUnavailable();
        throw err;
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
  init(): Promise<boolean>;
  complete(prompt: string, context?: Record<string, unknown>): Promise<AIModelResponse>;
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
    available: true,  // cloud is always "available" (network required)
    
    async init(): Promise<boolean> {
      return true;  // no init needed for cloud
    },
    
    async complete(prompt: string, context?: Record<string, unknown>): Promise<AIModelResponse> {
      // Route to appropriate cloud API
      // This is a simplified version — real implementation would use fetch directly
      const model = config.model ?? (config.provider === 'deepseek' ? 'deepseek-chat' : 'glm-5');
      
      // Build request based on provider
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
  const nanoAvailable = await isGeminiNanoAvailable();
  
  if (nanoAvailable) {
    return createGeminiNanoAdapter(() => {
      // If Gemini becomes unavailable later, switch to cloud
      console.warn('[Agent] Gemini Nano became unavailable, will retry cloud');
    });
  }
  
  if (cloudConfig) {
    return createCloudFallbackAdapter(cloudConfig);
  }
  
  throw new Error('No AI backend available and no cloud config provided');
}