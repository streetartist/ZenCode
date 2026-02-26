// LLM 类型定义 - OpenAI 兼容格式

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCallFunction {
  name: string;
  arguments: string; // JSON string
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: ToolCallFunction;
}

export interface Message {
  role: MessageRole;
  content: string | null;
  reasoning_content?: string | null; // deepseek-reasoner 思维链内容
  tool_calls?: ToolCall[];
  tool_call_id?: string; // 用于 tool 角色的消息
  name?: string;
}

export interface FunctionDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface ToolDefinition {
  type: 'function';
  function: FunctionDefinition;
}

export interface ChatCompletionRequest {
  model: string;
  messages: Message[];
  tools?: ToolDefinition[];
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface StreamDelta {
  role?: MessageRole;
  content?: string | null;
  reasoning_content?: string | null; // deepseek-reasoner 思维链流式内容
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: 'function';
    function?: {
      name?: string;
      arguments?: string;
    };
  }>;
}

export interface StreamChoice {
  index: number;
  delta: StreamDelta;
  finish_reason: string | null;
}

export interface StreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: StreamChoice[];
}

export interface ChatCompletionChoice {
  index: number;
  message: Message;
  finish_reason: string;
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
