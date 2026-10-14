import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { AiOutputError, AiUnavailableError } from './errors';
import type { AiClient, AiRequest, AiResponse } from './types';

/**
 * Claude via the official SDK. Server only: the key (ANTHROPIC_API_KEY) never reaches the
 * browser — this module imports 'server-only', and ESLint blocks importing it (or the SDK) from
 * client code. The model is `claude-opus-5-5` unless ANTHROPIC_MODEL overrides it.
 */
export const DEFAULT_MODEL = 'claude-opus-5-5';

export function createAnthropicClient(apiKey: string, model: string = DEFAULT_MODEL): AiClient {
  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });
  return {
    provider: 'anthropic',
    model,
    async complete(req: AiRequest): Promise<AiResponse> {
      let res: Anthropic.Beta.BetaMessage;
      try {
        res = await client.beta.messages.create({
          model,
          max_tokens: req.maxTokens,
          system: req.system,
          messages: req.messages,
          thinking: { type: 'adaptive' },
          output_config: {
            effort: 'medium',
            ...(req.json ? { format: { type: 'json_schema', schema: req.json.schema } } : {}),
          },
          // On a safety decline, the API re-runs the request on its default fallback model.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        });
      } catch (e) {
        if (e instanceof Anthropic.RateLimitError)
          throw new AiUnavailableError('The AI service is busy right now. Try again in a minute.');
        if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError)
          throw new AiUnavailableError('The AI service rejected the server’s credentials.');
        if (e instanceof Anthropic.APIError) throw new AiUnavailableError('The AI service could not answer.');
        throw e;
      }
      if (res.stop_reason === 'refusal') throw new AiUnavailableError('The AI declined this request.');
      if (res.stop_reason === 'max_tokens') throw new AiOutputError('the response was cut off');
      const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      return {
        text,
        model: res.model,
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
      };
    },
  };
}
