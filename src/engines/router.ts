import { configManager } from '../utils/config';
import { AntigravityDiscovery } from './discovery';
import { antigravityCore } from './antigravity-core';
import { geminiDirectEngine, GeminiGenerateRequest } from './gemini-direct';
import { ProtocolConverter } from './converter';
import { SSEStreamHelper } from '../utils/stream';
import { logger } from '../utils/logger';

export interface ExecutionStats {
  totalRequests: number;
  activeRequests: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  lastLatencyMs: number;
  antigravityConnected: boolean;
}

export class RequestRouter {
  private static instance: RequestRouter | null = null;
  private stats: ExecutionStats = {
    totalRequests: 0,
    activeRequests: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    lastLatencyMs: 0,
    antigravityConnected: false,
  };

  public static getInstance(): RequestRouter {
    if (!this.instance) {
      this.instance = new RequestRouter();
    }
    return this.instance;
  }

  public getStats(): ExecutionStats {
    return { ...this.stats };
  }

  /**
   * Routes a chat completion request in OpenAI format.
   */
  public async handleOpenAIChat(
    body: any,
    streamHelper?: SSEStreamHelper
  ): Promise<any> {
    const startTime = Date.now();
    this.stats.totalRequests++;
    this.stats.activeRequests++;

    const config = configManager.get();
    const resolvedModel = configManager.resolveModel(body.model);
    const requestId = `chatcmpl-${Math.random().toString(36).substring(2, 11)}`;

    try {
      const antigravityInstance = await AntigravityDiscovery.discover();
      this.stats.antigravityConnected = !!antigravityInstance;

      // Prefer direct Gemini if API key is provided and streaming is requested, or if Antigravity is not detected
      const hasApiKey = !!config.geminiApiKey;
      const isStreaming = !!body.stream;

      if (hasApiKey) {
        logger.debug(`Routing OpenAI request to Direct Gemini engine (${resolvedModel})`);
        const geminiReq = ProtocolConverter.openAIToGemini(body);

        if (isStreaming && streamHelper) {
          streamHelper.sendOpenAIChunk({
            id: requestId,
            model: resolvedModel,
            role: 'assistant',
            contentDelta: '',
          });

          await geminiDirectEngine.streamGenerateContent({
            apiKey: config.geminiApiKey!,
            model: resolvedModel,
            body: geminiReq,
            onChunk: (data) => {
              const candidate = data?.candidates?.[0];
              const text = candidate?.content?.parts?.map((p: any) => p.text || '').join('') || '';
              if (text) {
                streamHelper.sendOpenAIChunk({
                  id: requestId,
                  model: resolvedModel,
                  contentDelta: text,
                });
              }
            },
          });

          streamHelper.sendOpenAIDone();
          return;
        } else {
          const resp = await geminiDirectEngine.generateContent({
            apiKey: config.geminiApiKey!,
            model: resolvedModel,
            body: geminiReq,
          });

          const formatted = ProtocolConverter.geminiToOpenAI(resp, resolvedModel, requestId);
          this.recordTokenUsage(formatted.usage?.prompt_tokens, formatted.usage?.completion_tokens);
          return formatted;
        }
      }

      // Live Antigravity Language Server Engine
      if (antigravityInstance) {
        logger.debug(`Routing OpenAI request to Antigravity Live engine (${resolvedModel})`);
        const prompt = ProtocolConverter.messagesToAgentApiPrompt(body.messages);
        const tier = this.modelToTier(resolvedModel);

        if (isStreaming && streamHelper) {
          streamHelper.sendOpenAIChunk({
            id: requestId,
            model: resolvedModel,
            role: 'assistant',
            contentDelta: '',
          });

          await antigravityCore.generateViaAgentApi({
            prompt,
            modelTier: tier,
            onDelta: (chunk) => {
              streamHelper.sendOpenAIChunk({
                id: requestId,
                model: resolvedModel,
                contentDelta: chunk,
              });
            },
          });

          streamHelper.sendOpenAIDone();
          return;
        } else {
          const text = await antigravityCore.generateViaAgentApi({
            prompt,
            modelTier: tier,
          });

          return {
            id: requestId,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: resolvedModel,
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: text,
                },
                finish_reason: 'stop',
              },
            ],
            usage: {
              prompt_tokens: Math.ceil(prompt.length / 4),
              completion_tokens: Math.ceil(text.length / 4),
              total_tokens: Math.ceil((prompt.length + text.length) / 4),
            },
          };
        }
      }

      throw new Error('No available engine: Google Antigravity is not running, and no GEMINI_API_KEY is configured.');
    } finally {
      this.stats.activeRequests--;
      this.stats.lastLatencyMs = Date.now() - startTime;
    }
  }

  /**
   * Routes a messages request in Anthropic format (for Claude Code).
   */
  public async handleAnthropicMessages(
    body: any,
    streamHelper?: SSEStreamHelper
  ): Promise<any> {
    const startTime = Date.now();
    this.stats.totalRequests++;
    this.stats.activeRequests++;

    const config = configManager.get();
    const resolvedModel = configManager.resolveModel(body.model);
    const requestId = `msg_${Math.random().toString(36).substring(2, 15)}`;

    try {
      const antigravityInstance = await AntigravityDiscovery.discover();
      this.stats.antigravityConnected = !!antigravityInstance;

      const hasApiKey = !!config.geminiApiKey;
      const isStreaming = !!body.stream;

      if (hasApiKey) {
        logger.debug(`Routing Anthropic request to Direct Gemini engine (${resolvedModel})`);
        const geminiReq = ProtocolConverter.anthropicToGemini(body);

        if (isStreaming && streamHelper) {
          streamHelper.sendAnthropicMessageStart(requestId, resolvedModel, 20);
          streamHelper.sendAnthropicContentBlockStart(0, '');

          let outputTokens = 0;
          await geminiDirectEngine.streamGenerateContent({
            apiKey: config.geminiApiKey!,
            model: resolvedModel,
            body: geminiReq,
            onChunk: (data) => {
              const candidate = data?.candidates?.[0];
              const text = candidate?.content?.parts?.map((p: any) => p.text || '').join('') || '';
              if (text) {
                outputTokens += Math.ceil(text.length / 4);
                streamHelper.sendAnthropicTextDelta(0, text);
              }
            },
          });

          streamHelper.sendAnthropicContentBlockStop(0);
          streamHelper.sendAnthropicMessageDelta('end_turn', outputTokens);
          streamHelper.sendAnthropicMessageStop();
          return;
        } else {
          const resp = await geminiDirectEngine.generateContent({
            apiKey: config.geminiApiKey!,
            model: resolvedModel,
            body: geminiReq,
          });

          const formatted = ProtocolConverter.geminiToAnthropic(resp, resolvedModel, requestId);
          this.recordTokenUsage(formatted.usage?.input_tokens, formatted.usage?.output_tokens);
          return formatted;
        }
      }

      // Live Antigravity Language Server Engine
      if (antigravityInstance) {
        logger.debug(`Routing Anthropic request to Antigravity Live engine (${resolvedModel})`);
        const prompt = ProtocolConverter.messagesToAgentApiPrompt(body.messages, typeof body.system === 'string' ? body.system : undefined);
        const tier = this.modelToTier(resolvedModel);

        if (isStreaming && streamHelper) {
          streamHelper.sendAnthropicMessageStart(requestId, resolvedModel, Math.ceil(prompt.length / 4));
          streamHelper.sendAnthropicContentBlockStart(0, '');

          let outputTokens = 0;
          await antigravityCore.generateViaAgentApi({
            prompt,
            modelTier: tier,
            onDelta: (chunk) => {
              outputTokens += Math.ceil(chunk.length / 4);
              streamHelper.sendAnthropicTextDelta(0, chunk);
            },
          });

          streamHelper.sendAnthropicContentBlockStop(0);
          streamHelper.sendAnthropicMessageDelta('end_turn', outputTokens);
          streamHelper.sendAnthropicMessageStop();
          return;
        } else {
          const text = await antigravityCore.generateViaAgentApi({
            prompt,
            modelTier: tier,
          });

          return {
            id: requestId,
            type: 'message',
            role: 'assistant',
            model: resolvedModel,
            content: [{ type: 'text', text }],
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: {
              input_tokens: Math.ceil(prompt.length / 4),
              output_tokens: Math.ceil(text.length / 4),
            },
          };
        }
      }

      throw new Error('No available engine: Google Antigravity is not running, and no GEMINI_API_KEY is configured.');
    } finally {
      this.stats.activeRequests--;
      this.stats.lastLatencyMs = Date.now() - startTime;
    }
  }

  private modelToTier(model: string): 'flash_lite' | 'flash' | 'pro' {
    const lower = model.toLowerCase();
    if (lower.includes('pro') || lower.includes('opus') || lower.includes('gpt-4') || lower.includes('120b')) {
      return 'pro';
    }
    if (lower.includes('lite') || lower.includes('haiku') || lower.includes('mini')) {
      return 'flash_lite';
    }
    return 'flash';
  }

  private recordTokenUsage(promptTokens: number = 0, completionTokens: number = 0) {
    this.stats.totalPromptTokens += promptTokens;
    this.stats.totalCompletionTokens += completionTokens;
  }
}

export const requestRouter = RequestRouter.getInstance();
