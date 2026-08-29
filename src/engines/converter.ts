import { GeminiGenerateRequest, GeminiMessage, GeminiTool } from './gemini-direct';

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool' | 'function';
  content?: string | Array<{
    type: 'text' | 'image_url';
    text?: string;
    image_url?: { url: string };
  }>;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
}

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | Array<{
    type: 'text' | 'image' | 'tool_use' | 'tool_result' | 'thinking';
    text?: string;
    thinking?: string;
    source?: {
      type: 'base64';
      media_type: string;
      data: string;
    };
    id?: string;
    name?: string;
    input?: any;
    tool_use_id?: string;
    content?: string | Array<any>;
  }>;
}

export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: any;
}

export class ProtocolConverter {
  /**
   * Converts OpenAI Chat Completion request to Gemini GenerateContent request.
   */
  public static openAIToGemini(body: {
    messages: OpenAIMessage[];
    temperature?: number;
    top_p?: number;
    max_tokens?: number;
    tools?: Array<{
      type: 'function';
      function: {
        name: string;
        description?: string;
        parameters?: any;
      };
    }>;
    stop?: string | string[];
    response_format?: { type: string };
  }): GeminiGenerateRequest {
    const contents: GeminiMessage[] = [];
    let systemText = '';

    for (const msg of body.messages || []) {
      if (msg.role === 'system') {
        const text = typeof msg.content === 'string' ? msg.content : (msg.content?.map(c => c.text || '').join('\n') || '');
        systemText += (systemText ? '\n\n' : '') + text;
        continue;
      }

      if (msg.role === 'user') {
        const parts: any[] = [];
        if (typeof msg.content === 'string') {
          parts.push({ text: msg.content });
        } else if (Array.isArray(msg.content)) {
          for (const item of msg.content) {
            if (item.type === 'text' && item.text) {
              parts.push({ text: item.text });
            } else if (item.type === 'image_url' && item.image_url?.url) {
              const url = item.image_url.url;
              if (url.startsWith('data:')) {
                const match = url.match(/^data:([^;]+);base64,(.+)$/);
                if (match) {
                  parts.push({
                    inlineData: {
                      mimeType: match[1],
                      data: match[2],
                    },
                  });
                }
              }
            }
          }
        }
        contents.push({ role: 'user', parts });
      } else if (msg.role === 'assistant') {
        const parts: any[] = [];
        if (msg.content) {
          const text = typeof msg.content === 'string' ? msg.content : (msg.content?.map(c => c.text || '').join('\n') || '');
          if (text) parts.push({ text });
        }
        if (msg.tool_calls) {
          for (const tc of msg.tool_calls) {
            let args = {};
            try {
              args = JSON.parse(tc.function.arguments || '{}');
            } catch {
              // ignore
            }
            parts.push({
              functionCall: {
                name: tc.function.name,
                args,
              },
            });
          }
        }
        contents.push({ role: 'model', parts });
      } else if (msg.role === 'tool') {
        let respObj = {};
        try {
          respObj = typeof msg.content === 'string' ? JSON.parse(msg.content) : msg.content;
        } catch {
          respObj = { output: msg.content };
        }
        contents.push({
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: msg.name || 'tool_response',
                response: respObj,
              },
            },
          ],
        });
      }
    }

    const tools: GeminiTool[] = [];
    if (body.tools && body.tools.length > 0) {
      const declarations = body.tools.map(t => ({
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      }));
      tools.push({ functionDeclarations: declarations });
    }

    const stopSequences = Array.isArray(body.stop) ? body.stop : (body.stop ? [body.stop] : undefined);

    return {
      contents,
      systemInstruction: systemText ? { parts: [{ text: systemText }] } : undefined,
      tools: tools.length > 0 ? tools : undefined,
      generationConfig: {
        temperature: body.temperature,
        topP: body.top_p,
        maxOutputTokens: body.max_tokens,
        stopSequences,
        responseMimeType: body.response_format?.type === 'json_object' ? 'application/json' : undefined,
      },
    };
  }

  /**
   * Converts Anthropic Messages request to Gemini GenerateContent request.
   */
  public static anthropicToGemini(body: {
    messages: AnthropicMessage[];
    system?: string | Array<{ type: string; text: string }>;
    max_tokens?: number;
    temperature?: number;
    top_p?: number;
    top_k?: number;
    stop_sequences?: string[];
    tools?: AnthropicTool[];
    thinking?: { type: string; budget_tokens?: number };
  }): GeminiGenerateRequest {
    const contents: GeminiMessage[] = [];

    let systemText = '';
    if (typeof body.system === 'string') {
      systemText = body.system;
    } else if (Array.isArray(body.system)) {
      systemText = body.system.map(s => s.text || '').join('\n\n');
    }

    for (const msg of body.messages || []) {
      const role = msg.role === 'assistant' ? 'model' : 'user';
      const parts: any[] = [];

      if (typeof msg.content === 'string') {
        parts.push({ text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'text' && block.text) {
            parts.push({ text: block.text });
          } else if (block.type === 'thinking' && block.thinking) {
            parts.push({ text: `[Thinking: ${block.thinking}]` });
          } else if (block.type === 'image' && block.source?.data) {
            parts.push({
              inlineData: {
                mimeType: block.source.media_type,
                data: block.source.data,
              },
            });
          } else if (block.type === 'tool_use') {
            parts.push({
              functionCall: {
                name: block.name,
                args: block.input || {},
              },
            });
          } else if (block.type === 'tool_result') {
            const contentStr = typeof block.content === 'string' ? block.content : JSON.stringify(block.content || {});
            let respObj = {};
            try {
              respObj = JSON.parse(contentStr);
            } catch {
              respObj = { output: contentStr };
            }
            parts.push({
              functionResponse: {
                name: block.tool_use_id || 'tool_response',
                response: respObj,
              },
            });
          }
        }
      }

      contents.push({ role, parts });
    }

    const tools: GeminiTool[] = [];
    if (body.tools && body.tools.length > 0) {
      const declarations = body.tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      }));
      tools.push({ functionDeclarations: declarations });
    }

    return {
      contents,
      systemInstruction: systemText ? { parts: [{ text: systemText }] } : undefined,
      tools: tools.length > 0 ? tools : undefined,
      generationConfig: {
        temperature: body.temperature,
        topP: body.top_p,
        topK: body.top_k,
        maxOutputTokens: body.max_tokens,
        stopSequences: body.stop_sequences,
        thinkingConfig: body.thinking?.budget_tokens ? { thinkingBudget: body.thinking.budget_tokens } : undefined,
      },
    };
  }

  /**
   * Converts Gemini response to OpenAI Chat Completion format.
   */
  public static geminiToOpenAI(geminiResp: any, model: string, id: string): any {
    const candidate = geminiResp?.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    
    let textContent = '';
    const toolCalls: any[] = [];

    for (const p of parts) {
      if (p.text) textContent += p.text;
      if (p.functionCall) {
        toolCalls.push({
          id: `call_${Math.random().toString(36).substring(2, 9)}`,
          type: 'function',
          function: {
            name: p.functionCall.name,
            arguments: JSON.stringify(p.functionCall.args || {}),
          },
        });
      }
    }

    const finishReasonMap: Record<string, string> = {
      'STOP': 'stop',
      'MAX_TOKENS': 'length',
      'SAFETY': 'content_filter',
      'RECITATION': 'content_filter',
    };
    const finishReason = finishReasonMap[candidate?.finishReason] || (toolCalls.length > 0 ? 'tool_calls' : 'stop');

    return {
      id,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: textContent || null,
            ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
          },
          finish_reason: finishReason,
        },
      ],
      usage: {
        prompt_tokens: geminiResp?.usageMetadata?.promptTokenCount || 0,
        completion_tokens: geminiResp?.usageMetadata?.candidatesTokenCount || 0,
        total_tokens: geminiResp?.usageMetadata?.totalTokenCount || 0,
      },
    };
  }

  /**
   * Converts Gemini response to Anthropic Message format.
   */
  public static geminiToAnthropic(geminiResp: any, model: string, id: string): any {
    const candidate = geminiResp?.candidates?.[0];
    const parts = candidate?.content?.parts || [];

    const content: any[] = [];

    for (const p of parts) {
      if (p.text) {
        content.push({
          type: 'text',
          text: p.text,
        });
      }
      if (p.functionCall) {
        content.push({
          type: 'tool_use',
          id: `toolu_${Math.random().toString(36).substring(2, 9)}`,
          name: p.functionCall.name,
          input: p.functionCall.args || {},
        });
      }
    }

    const stopReasonMap: Record<string, string> = {
      'STOP': 'end_turn',
      'MAX_TOKENS': 'max_tokens',
      'SAFETY': 'stop_sequence',
    };
    const stopReason = content.some(c => c.type === 'tool_use') ? 'tool_use' : (stopReasonMap[candidate?.finishReason] || 'end_turn');

    return {
      id,
      type: 'message',
      role: 'assistant',
      model,
      content,
      stop_reason: stopReason,
      stop_sequence: null,
      usage: {
        input_tokens: geminiResp?.usageMetadata?.promptTokenCount || 0,
        output_tokens: geminiResp?.usageMetadata?.candidatesTokenCount || 0,
      },
    };
  }

  /**
   * Flattens messages array to a single prompt string for Antigravity agentapi.
   */
  public static messagesToAgentApiPrompt(
    messages: Array<OpenAIMessage | AnthropicMessage>,
    system?: string,
    tools?: any[]
  ): string {
    let fullPrompt = '';
    if (system) {
      fullPrompt += `System Instructions:\n${system}\n\n`;
    }

    if (tools && tools.length > 0) {
      fullPrompt += `Available Tools:\n${JSON.stringify(tools, null, 2)}\n\n`;
    }

    for (const m of messages) {
      const role = m.role.toUpperCase();
      let text = '';
      if (typeof m.content === 'string') {
        text = m.content;
      } else if (Array.isArray(m.content)) {
        text = m.content.map((c: any) => {
          if (c.type === 'text') return c.text || '';
          if (c.type === 'tool_use') return `[Tool Call: ${c.name} (${JSON.stringify(c.input || {})})]`;
          if (c.type === 'tool_result') return `[Tool Result (${c.tool_use_id || ''}): ${typeof c.content === 'string' ? c.content : JSON.stringify(c.content || {})}]`;
          return c.text || c.thinking || JSON.stringify(c);
        }).join('\n');
      }
      fullPrompt += `[${role}]\n${text}\n\n`;
    }

    return fullPrompt.trim();
  }
}
