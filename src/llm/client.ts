import OpenAI from 'openai';
import type {
  Message,
  ToolDefinition,
  ToolCall,
  StreamDelta,
} from './types.js';

export interface LLMClientOptions {
  apiKey: string;
  baseURL: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export interface StreamCallbacks {
  onContent?: (text: string) => void;
  onToolCall?: (toolCall: ToolCall) => void;
  onToolCallStreaming?: (index: number, name: string, accumulatedArgs: string) => void;
  onFinish?: (message: Message) => void;
  onError?: (error: Error) => void;
}

export class LLMClient {
  private client: OpenAI;
  private model: string;
  private temperature: number;
  private maxTokens: number;
  private activeAbortController: AbortController | null = null;

  constructor(options: LLMClientOptions) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
    });
    this.model = options.model;
    this.temperature = options.temperature ?? 0.7;
    this.maxTokens = options.maxTokens ?? 8192;
  }

  /**
   * 流式调用 LLM，实时回调文本内容和工具调用
   */
  async chatStream(
    messages: Message[],
    tools: ToolDefinition[] | undefined,
    callbacks: StreamCallbacks,
  ): Promise<Message> {
    const params: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
      model: this.model,
      messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
      temperature: this.temperature,
      max_tokens: this.maxTokens,
      stream: true,
    };

    if (tools && tools.length > 0) {
      params.tools = tools as OpenAI.Chat.ChatCompletionTool[];
      params.tool_choice = 'auto';
    }

    // Request usage info in stream
    params.stream_options = { include_usage: true };

    const abortController = new AbortController();
    this.activeAbortController = abortController;

    try {
      const stream = await this.client.chat.completions.create(params, {
        signal: abortController.signal,
      });

      let contentParts: string[] = [];
      let reasoningParts: string[] = [];
      let reasoningStarted = false;
      let reasoningEnded = false;
      const toolCallMap = new Map<number, { id: string; name: string; args: string }>();
      let usageInfo: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null = null;

      for await (const chunk of stream) {
        // 捕获 usage（最后一个 chunk 包含）
        const chunkUsage = (chunk as any).usage;
        if (chunkUsage && chunkUsage.total_tokens) {
          usageInfo = {
            prompt_tokens: chunkUsage.prompt_tokens ?? 0,
            completion_tokens: chunkUsage.completion_tokens ?? 0,
            total_tokens: chunkUsage.total_tokens,
          };
        }

        const choice = chunk.choices[0];
        if (!choice) continue;

        const delta: StreamDelta = choice.delta as StreamDelta;

        // 处理 reasoning_content（deepseek-reasoner 思维链）
        if (delta.reasoning_content) {
          reasoningParts.push(delta.reasoning_content);
          // 首个 reasoning chunk 前注入 <think> 标签，让 thinkFilter 渲染
          if (!reasoningStarted) {
            reasoningStarted = true;
            callbacks.onContent?.('<think>');
          }
          callbacks.onContent?.(delta.reasoning_content);
        }

        // 处理文本内容
        if (delta.content) {
          // reasoning → content 过渡时注入 </think>
          if (reasoningStarted && !reasoningEnded) {
            reasoningEnded = true;
            callbacks.onContent?.('</think>');
          }
          contentParts.push(delta.content);
          callbacks.onContent?.(delta.content);
        }

        // 处理工具调用（流式中分片到达）
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const existing = toolCallMap.get(tc.index);
            if (existing) {
              if (tc.function?.arguments) {
                existing.args += tc.function.arguments;
              }
            } else {
              toolCallMap.set(tc.index, {
                id: tc.id || '',
                name: tc.function?.name || '',
                args: tc.function?.arguments || '',
              });
            }

            // 流式回调：write-file / edit-file 的参数实时推送
            const entry = toolCallMap.get(tc.index);
            if (entry && callbacks.onToolCallStreaming) {
              const n = entry.name;
              if (n === 'write-file' || n === 'edit-file') {
                callbacks.onToolCallStreaming(tc.index, n, entry.args);
              }
            }
          }
        }
      }

      // reasoning 结束但没有 content 跟随时（如只返回 tool_calls），关闭 think 标签
      if (reasoningStarted && !reasoningEnded) {
        reasoningEnded = true;
        callbacks.onContent?.('</think>');
      }

      // 组装完整的 tool_calls
      const toolCalls: ToolCall[] = [];
      for (const [, tc] of [...toolCallMap.entries()].sort(([a], [b]) => a - b)) {
        const toolCall: ToolCall = {
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: tc.args,
          },
        };
        toolCalls.push(toolCall);
        callbacks.onToolCall?.(toolCall);
      }

      const fullContent = contentParts.join('');
      const fullReasoning = reasoningParts.join('');
      const assistantMessage: Message = {
        role: 'assistant',
        content: fullContent || null,
      };

      if (fullReasoning) {
        assistantMessage.reasoning_content = fullReasoning;
      }

      if (toolCalls.length > 0) {
        assistantMessage.tool_calls = toolCalls;
      }

      if (usageInfo) {
        assistantMessage.usage = usageInfo;
      }

      callbacks.onFinish?.(assistantMessage);
      return assistantMessage;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (!isAbortError(err)) {
        callbacks.onError?.(err);
      }
      throw err;
    } finally {
      if (this.activeAbortController === abortController) {
        this.activeAbortController = null;
      }
    }
  }

  /**
   * 非流式调用 LLM
   */
  async chat(
    messages: Message[],
    tools?: ToolDefinition[],
  ): Promise<Message> {
    const params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model: this.model,
      messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
      temperature: this.temperature,
      max_tokens: this.maxTokens,
      stream: false,
    };

    if (tools && tools.length > 0) {
      params.tools = tools as OpenAI.Chat.ChatCompletionTool[];
      params.tool_choice = 'auto';
    }

    const response = await this.client.chat.completions.create(params);
    const choice = response.choices[0];
    if (!choice) {
      throw new Error('No response from LLM');
    }

    const msg = choice.message;
    const result: Message = {
      role: 'assistant',
      content: msg.content,
    };

    // 捕获 reasoning_content（deepseek-reasoner）
    const reasoning = (msg as unknown as Record<string, unknown>).reasoning_content;
    if (reasoning && typeof reasoning === 'string') {
      result.reasoning_content = reasoning;
    }

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      result.tool_calls = msg.tool_calls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      }));
    }

    // 捕获 token 用量
    if (response.usage) {
      result.usage = {
        prompt_tokens: response.usage.prompt_tokens,
        completion_tokens: response.usage.completion_tokens,
        total_tokens: response.usage.total_tokens,
      };
    }

    return result;
  }

  get modelName(): string {
    return this.model;
  }

  abortActiveStream(): void {
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }
  }
}

export function isAbortError(error: unknown): boolean {
  if (!error) return false;
  const err = error as { name?: string; message?: string; code?: string; cause?: { name?: string; code?: string } };
  const name = err.name || err.cause?.name || '';
  const code = err.code || err.cause?.code || '';
  const message = err.message || '';

  return (
    name === 'AbortError' ||
    name === 'APIUserAbortError' ||
    code === 'ABORT_ERR' ||
    /abort|aborted|cancel|cancelled|canceled|interrupted/i.test(message)
  );
}

/**
 * 从配置创建 LLM 客户端
 */
export function createLLMClient(options: LLMClientOptions): LLMClient {
  return new LLMClient(options);
}
