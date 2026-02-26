import type { TodoPlan } from '../../core/todo-store.js';
import type { SubAgentProgress } from '../../core/sub-agent-tracker.js';

// TUI state management with useReducer

export interface ToolCallState {
  id: string;
  name: string;
  params: Record<string, unknown>;
  status: 'running' | 'done' | 'denied' | 'confirming';
  resultSummary?: string;
  resultContent?: string;
  denyFeedback?: string;
  streamingContent?: string;
}

export type ConfirmResult = 'allow' | 'deny' | 'always' | { feedback: string };

export interface ConfirmPending {
  toolName: string;
  params: Record<string, unknown>;
  resolve: (result: ConfirmResult) => void;
}

// Content blocks: text, tool calls and thoughts are interleaved in order
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thought'; text: string }
  | { type: 'tool'; toolCall: ToolCallState };

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  blocks: ContentBlock[];
  isStreaming: boolean;
  confirmPending?: ConfirmPending;
}

export interface TuiState {
  messages: ChatMessage[];
  isRunning: boolean;
  error?: string;
  modelName: string;
  todoPlan: TodoPlan | null;
  subAgentProgress: SubAgentProgress | null;
}

export function createInitialState(modelName: string): TuiState {
  return {
    messages: [],
    isRunning: false,
    error: undefined,
    modelName,
    todoPlan: null,
    subAgentProgress: null,
  };
}

// Action types
export type TuiAction =
  | { type: 'ADD_USER_MESSAGE'; text: string }
  | { type: 'START_ASSISTANT' }
  | { type: 'APPEND_CONTENT'; text: string }
  | { type: 'APPEND_THOUGHT'; text: string }
  | { type: 'TOOL_EXECUTING'; id: string; name: string; params: Record<string, unknown> }
  | { type: 'TOOL_STREAMING'; id: string; name: string; streamingContent: string }
  | { type: 'TOOL_RESULT'; id: string; resultSummary: string; resultContent?: string }
  | { type: 'TOOL_DENIED'; id: string; feedback?: string }
  | { type: 'TOOL_CONFIRMING'; id: string; name: string; params: Record<string, unknown>; resolve: (r: ConfirmResult) => void }
  | { type: 'CONFIRM_RESPONDED'; id: string }
  | { type: 'FINISH_STREAMING' }
  | { type: 'SET_RUNNING'; running: boolean }
  | { type: 'SET_ERROR'; error: string }
  | { type: 'CLEAR_ERROR' }
  | { type: 'CLEAR_MESSAGES' }
  | { type: 'SET_TODO_PLAN'; plan: TodoPlan | null }
  | { type: 'SET_SUB_AGENT_PROGRESS'; progress: SubAgentProgress | null };

let messageCounter = 0;
function nextId(): string {
  return `msg-${++messageCounter}`;
}

function updateLastAssistant(messages: ChatMessage[], updater: (msg: ChatMessage) => ChatMessage): ChatMessage[] {
  const result = [...messages];
  for (let i = result.length - 1; i >= 0; i--) {
    if (result[i]!.role === 'assistant') {
      result[i] = updater(result[i]!);
      return result;
    }
  }
  return result;
}

/** Helper to find and update a tool block by id across all blocks */
function updateToolInBlocks(blocks: ContentBlock[], toolId: string, updater: (tc: ToolCallState) => ToolCallState): ContentBlock[] {
  return blocks.map(b => {
    if (b.type === 'tool' && b.toolCall.id === toolId) {
      return { type: 'tool' as const, toolCall: updater(b.toolCall) };
    }
    return b;
  });
}

export function tuiReducer(state: TuiState, action: TuiAction): TuiState {
  switch (action.type) {
    case 'ADD_USER_MESSAGE':
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            id: nextId(),
            role: 'user',
            blocks: [{ type: 'text', text: action.text }],
            isStreaming: false,
          },
        ],
      };

    case 'START_ASSISTANT':
      return {
        ...state,
        error: undefined,
        messages: [
          ...state.messages,
          {
            id: nextId(),
            role: 'assistant',
            blocks: [],
            isStreaming: true,
          },
        ],
      };

    case 'APPEND_CONTENT': {
      return {
        ...state,
        messages: updateLastAssistant(state.messages, (msg) => {
          const blocks = [...msg.blocks];
          const last = blocks[blocks.length - 1];
          if (last && last.type === 'text') {
            // Append to existing text block
            blocks[blocks.length - 1] = { type: 'text', text: last.text + action.text };
          } else {
            // Create new text block (after a tool block or empty)
            blocks.push({ type: 'text', text: action.text });
          }
          return { ...msg, blocks };
        }),
      };
    }

    case 'APPEND_THOUGHT': {
      return {
        ...state,
        messages: updateLastAssistant(state.messages, (msg) => {
          const blocks = [...msg.blocks];
          const last = blocks[blocks.length - 1];
          if (last && last.type === 'thought') {
            // Append to existing thought block
            blocks[blocks.length - 1] = { type: 'thought', text: last.text + action.text };
          } else {
            // Create new thought block
            blocks.push({ type: 'thought', text: action.text });
          }
          return { ...msg, blocks };
        }),
      };
    }

    case 'TOOL_EXECUTING': {
      return {
        ...state,
        messages: updateLastAssistant(state.messages, (msg) => {
          // Check if a tool block with this id already exists (from confirming or streaming)
          const existingIdx = msg.blocks.findIndex(
            b => b.type === 'tool' && b.toolCall.id === action.id,
          );
          if (existingIdx >= 0) {
            // Update existing block: set status to running, fill in final params
            return {
              ...msg,
              blocks: updateToolInBlocks(msg.blocks, action.id, tc => ({
                ...tc,
                status: 'running' as const,
                params: action.params,
              })),
            };
          }
          // Add new tool block
          return {
            ...msg,
            blocks: [
              ...msg.blocks,
              {
                type: 'tool' as const,
                toolCall: {
                  id: action.id,
                  name: action.name,
                  params: action.params,
                  status: 'running' as const,
                },
              },
            ],
          };
        }),
      };
    }

    case 'TOOL_STREAMING': {
      return {
        ...state,
        messages: updateLastAssistant(state.messages, (msg) => {
          // Check if streaming tool block already exists
          const existingIdx = msg.blocks.findIndex(
            b => b.type === 'tool' && b.toolCall.id === action.id,
          );
          if (existingIdx >= 0) {
            // Update streaming content
            return {
              ...msg,
              blocks: updateToolInBlocks(msg.blocks, action.id, tc => ({
                ...tc,
                streamingContent: action.streamingContent,
              })),
            };
          }
          // Create new tool block with streaming status
          return {
            ...msg,
            blocks: [
              ...msg.blocks,
              {
                type: 'tool' as const,
                toolCall: {
                  id: action.id,
                  name: action.name,
                  params: {},
                  status: 'running' as const,
                  streamingContent: action.streamingContent,
                },
              },
            ],
          };
        }),
      };
    }

    case 'TOOL_RESULT': {
      return {
        ...state,
        messages: updateLastAssistant(state.messages, (msg) => ({
          ...msg,
          blocks: updateToolInBlocks(msg.blocks, action.id, tc => ({
            ...tc,
            status: 'done' as const,
            resultSummary: action.resultSummary,
            resultContent: action.resultContent,
          })),
        })),
      };
    }

    case 'TOOL_DENIED': {
      return {
        ...state,
        messages: updateLastAssistant(state.messages, (msg) => ({
          ...msg,
          blocks: updateToolInBlocks(msg.blocks, action.id, tc => ({
            ...tc,
            status: 'denied' as const,
            denyFeedback: action.feedback,
          })),
        })),
      };
    }

    case 'TOOL_CONFIRMING': {
      return {
        ...state,
        messages: updateLastAssistant(state.messages, (msg) => ({
          ...msg,
          blocks: [
            ...msg.blocks,
            {
              type: 'tool' as const,
              toolCall: {
                id: action.id,
                name: action.name,
                params: action.params,
                status: 'confirming' as const,
              },
            },
          ],
          confirmPending: {
            toolName: action.name,
            params: action.params,
            resolve: action.resolve,
          },
        })),
      };
    }

    case 'CONFIRM_RESPONDED': {
      return {
        ...state,
        messages: updateLastAssistant(state.messages, (msg) => ({
          ...msg,
          confirmPending: undefined,
        })),
      };
    }

    case 'FINISH_STREAMING':
      return {
        ...state,
        messages: updateLastAssistant(state.messages, (msg) => ({
          ...msg,
          isStreaming: false,
        })),
      };

    case 'SET_RUNNING':
      return { ...state, isRunning: action.running };

    case 'SET_ERROR':
      return { ...state, error: action.error, isRunning: false };

    case 'CLEAR_ERROR':
      return { ...state, error: undefined };

    case 'CLEAR_MESSAGES':
      return { ...state, messages: [] };

    case 'SET_TODO_PLAN':
      return { ...state, todoPlan: action.plan };

    case 'SET_SUB_AGENT_PROGRESS':
      return { ...state, subAgentProgress: action.progress };

    default:
      return state;
  }
}
