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
  | { type: 'SET_SUB_AGENT_PROGRESS'; progress: SubAgentProgress | null }
  | { type: 'BATCH'; actions: TuiAction[] };

let messageCounter = 0;
function nextId(): string {
  return `msg-${++messageCounter}`;
}

function updateLastAssistant(messages: ChatMessage[], updater: (msg: ChatMessage) => ChatMessage): ChatMessage[] {
  const result = [...messages];
  for (let i = result.length - 1; i >= 0; i--) {
    if (result[i]!.role === 'assistant') {
      const updated = updater(result[i]!);
      if (updated === result[i]) return messages; // CRITICAL: Bail out if no change
      result[i] = updated;
      return result;
    }
  }
  return result;
}

/** Helper to find and update a tool block by id across all blocks */
function updateToolInBlocks(blocks: ContentBlock[], toolId: string, updater: (tc: ToolCallState) => ToolCallState): ContentBlock[] {
  let changed = false;
  const newBlocks = blocks.map(b => {
    if (b.type === 'tool' && b.toolCall.id === toolId) {
      const updatedTc = updater(b.toolCall);
      if (updatedTc === b.toolCall) return b;
      changed = true;
      return { type: 'tool' as const, toolCall: updatedTc };
    }
    return b;
  });
  return changed ? newBlocks : blocks;
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
      if (!action.text) return state;
      const newMessages = updateLastAssistant(state.messages, (msg) => {
        const blocks = [...msg.blocks];
        const last = blocks[blocks.length - 1];
        if (last && last.type === 'text') {
          blocks[blocks.length - 1] = { type: 'text', text: last.text + action.text };
        } else {
          blocks.push({ type: 'text', text: action.text });
        }
        return { ...msg, blocks };
      });
      if (newMessages === state.messages) return state;
      return { ...state, messages: newMessages };
    }

    case 'APPEND_THOUGHT': {
      if (!action.text) return state;
      const newMessages = updateLastAssistant(state.messages, (msg) => {
        const blocks = [...msg.blocks];
        const last = blocks[blocks.length - 1];
        if (last && last.type === 'thought') {
          blocks[blocks.length - 1] = { type: 'thought', text: last.text + action.text };
        } else {
          blocks.push({ type: 'thought', text: action.text });
        }
        return { ...msg, blocks };
      });
      if (newMessages === state.messages) return state;
      return { ...state, messages: newMessages };
    }

    case 'TOOL_EXECUTING': {
      const newMessages = updateLastAssistant(state.messages, (msg) => {
        const existingIdx = msg.blocks.findIndex(
          b => b.type === 'tool' && b.toolCall.id === action.id,
        );
        if (existingIdx >= 0) {
          const newBlocks = updateToolInBlocks(msg.blocks, action.id, tc => {
             if (tc.status === 'running' && JSON.stringify(tc.params) === JSON.stringify(action.params)) return tc;
             return { ...tc, status: 'running' as const, params: action.params };
          });
          if (newBlocks === msg.blocks) return msg;
          return { ...msg, blocks: newBlocks };
        }
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
      });
      
      if (newMessages === state.messages) return state;
      return { ...state, messages: newMessages };
    }

    case 'TOOL_STREAMING': {
      const { id, streamingContent, name } = action;
      const newMessages = updateLastAssistant(state.messages, (msg) => {
        const existingBlock = msg.blocks.find(
          b => b.type === 'tool' && b.toolCall.id === id,
        );
        if (existingBlock && existingBlock.type === 'tool' && existingBlock.toolCall.streamingContent === streamingContent) {
          return msg; // NO VISUAL CHANGE -> BAIL OUT
        }

        if (existingBlock) {
          return {
            ...msg,
            blocks: updateToolInBlocks(msg.blocks, id, tc => ({
              ...tc,
              streamingContent,
            })),
          };
        }
        return {
          ...msg,
          blocks: [
            ...msg.blocks,
            {
              type: 'tool' as const,
              toolCall: {
                id,
                name,
                params: {},
                status: 'running' as const,
                streamingContent,
              },
            },
          ],
        };
      });

      if (newMessages === state.messages) {
        return state;
      }
      return { ...state, messages: newMessages };
    }

    case 'TOOL_RESULT': {
      const newMessages = updateLastAssistant(state.messages, (msg) => {
        const newBlocks = updateToolInBlocks(msg.blocks, action.id, tc => {
          if (tc.status === 'done' && tc.resultSummary === action.resultSummary) return tc;
          return { ...tc, status: 'done' as const, resultSummary: action.resultSummary, resultContent: action.resultContent };
        });
        if (newBlocks === msg.blocks) return msg;
        return { ...msg, blocks: newBlocks };
      });
      
      if (newMessages === state.messages) return state;
      return { ...state, messages: newMessages };
    }

    case 'TOOL_DENIED': {
      const newMessages = updateLastAssistant(state.messages, (msg) => {
        const newBlocks = updateToolInBlocks(msg.blocks, action.id, tc => ({
          ...tc,
          status: 'denied' as const,
          denyFeedback: action.feedback,
        }));
        if (newBlocks === msg.blocks) return msg;
        return { ...msg, blocks: newBlocks };
      });
      if (newMessages === state.messages) return state;
      return { ...state, messages: newMessages };
    }

    case 'TOOL_CONFIRMING': {
      const newMessages = updateLastAssistant(state.messages, (msg) => ({
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
      }));
      return { ...state, messages: newMessages };
    }

    case 'CONFIRM_RESPONDED': {
      const newMessages = updateLastAssistant(state.messages, (msg) => {
        if (!msg.confirmPending) return msg;
        return { ...msg, confirmPending: undefined };
      });
      if (newMessages === state.messages) return state;
      return { ...state, messages: newMessages };
    }

    case 'FINISH_STREAMING':
      const newMessages = updateLastAssistant(state.messages, (msg) => {
        if (!msg.isStreaming) return msg;
        return { ...msg, isStreaming: false };
      });
      if (newMessages === state.messages) return state;
      return { ...state, messages: newMessages };

    case 'SET_RUNNING':
      if (state.isRunning === action.running) return state;
      return { ...state, isRunning: action.running };

    case 'SET_ERROR':
      return { ...state, error: action.error, isRunning: false };

    case 'CLEAR_ERROR':
      if (state.error === undefined) return state;
      return { ...state, error: undefined };

    case 'CLEAR_MESSAGES':
      if (state.messages.length === 0) return state;
      return { ...state, messages: [] };

    case 'SET_TODO_PLAN':
      if (state.todoPlan === action.plan) return state;
      return { ...state, todoPlan: action.plan };

    case 'SET_SUB_AGENT_PROGRESS':
      if (JSON.stringify(state.subAgentProgress) === JSON.stringify(action.progress)) return state;
      return { ...state, subAgentProgress: action.progress };

    case 'BATCH':
      const newState = action.actions.reduce((s, a) => tuiReducer(s, a), state);
      return newState === state ? state : newState;

    default:
      return state;
  }
}
