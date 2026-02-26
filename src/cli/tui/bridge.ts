// Bridge: Agent callbacks → TUI dispatch
// Includes token batching to avoid excessive React re-renders

import type { Dispatch } from 'react';
import type { AgentCallbacks } from '../../core/agent.js';
import type { TuiAction } from './state.js';

const BATCH_INTERVAL_MS = 64; // ~15fps, balances smoothness vs flicker for fullscreen redraw

const ANSI_GRAY = '\x1b[90m';
const ANSI_RESET = '\x1b[0m';

function gray(text: string): string {
  return `${ANSI_GRAY}${text}${ANSI_RESET}`;
}

/**
 * 流式 <think> 标签转换器 (For standard REPL)
 * 轻量样式：标题 + 缩进内容（无边框）
 */
export function createThinkFilter() {
  let inThink = false;
  let tagBuffer = '';
  let thinkLineBuffer = '';
  let thinkHasVisibleContent = false;
  let thinkLastEmittedBlank = false;
  let postThink = false;

  function flushThinkLine(rawLine: string): string {
    const normalized = rawLine.trim();
    if (!thinkHasVisibleContent && normalized.length === 0) return '';
    if (normalized.length === 0) {
      if (thinkLastEmittedBlank) return '';
      thinkLastEmittedBlank = true;
      return '\n';
    }
    thinkHasVisibleContent = true;
    thinkLastEmittedBlank = false;
    return `${gray(`  ${normalized}`)}\n`;
  }

  function appendOutsideText(current: string, text: string): string {
    if (!postThink) return current + text;
    let result = current;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      if (postThink && (ch === '\n' || ch === '\r' || ch === ' ' || ch === '\t')) {
        continue;
      }
      postThink = false;
      result += text.slice(i);
      break;
    }
    return result;
  }

  function appendThinkText(current: string, text: string): string {
    let result = current;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      if (ch === '\r') continue;
      if (ch === '\n') {
        result += flushThinkLine(thinkLineBuffer);
        thinkLineBuffer = '';
      } else {
        thinkLineBuffer += ch;
      }
    }
    return result;
  }

  return function filter(text: string): string {
    let result = '';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      if (tagBuffer.length > 0) {
        tagBuffer += ch;
        if (tagBuffer === '<think>') {
          inThink = true;
          thinkLineBuffer = '';
          thinkHasVisibleContent = false;
          thinkLastEmittedBlank = false;
          tagBuffer = '';
          result += `${gray('Thinking')}\n`;
        } else if (tagBuffer === '</think>') {
          inThink = false;
          postThink = true;
          tagBuffer = '';
          if (thinkLineBuffer.length > 0) {
            result += flushThinkLine(thinkLineBuffer);
            thinkLineBuffer = '';
          }
          while (result.endsWith('\n\n\n')) result = result.slice(0, -1);
          result += '\n';
        } else if (!'<think>'.startsWith(tagBuffer) && !'</think>'.startsWith(tagBuffer)) {
          if (inThink) result = appendThinkText(result, tagBuffer);
          else result = appendOutsideText(result, tagBuffer);
          tagBuffer = '';
        }
        continue;
      }
      if (ch === '<') {
        tagBuffer = '<';
        continue;
      }
      if (inThink) result = appendThinkText(result, ch);
      else result = appendOutsideText(result, ch);
    }
    return result;
  };
}

/**
 * Creates a token batcher that accumulates streaming content
 * and flushes to dispatch at a fixed interval.
 */
function createTokenBatcher(dispatch: Dispatch<TuiAction>, type: 'APPEND_CONTENT' | 'APPEND_THOUGHT') {
  let buffer = '';
  let timer: ReturnType<typeof setInterval> | null = null;

  function flush() {
    if (buffer.length > 0) {
      const text = buffer;
      buffer = '';
      dispatch({ type, text } as any);
    }
  }

  function start() {
    if (!timer) {
      timer = setInterval(flush, BATCH_INTERVAL_MS);
    }
  }

  function stop() {
    flush();
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function append(text: string) {
    buffer += text;
    start();
  }

  function pause() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { append, stop, flush, pause };
}

// Track tool call IDs for mapping tool results back
let toolCallCounter = 0;
let activeToolIds: Map<string, string> = new Map();
// Track streaming tool index → id
let streamingToolIds: Map<number, string> = new Map();
// Track last streaming args per tool id (for computing code line count on result)
let lastStreamingArgs: Map<string, string> = new Map();

/**
 * 从部分 JSON 参数中提取代码内容（write-file 的 content 或 edit-file 的 new_string）
 */
function extractCodeFromArgs(name: string, args: string): string | null {
  const field = name === 'write-file' ? 'content' : 'new_string';
  const patterns = [`"${field}": "`, `"${field}":"`];
  for (const pattern of patterns) {
    const idx = args.indexOf(pattern);
    if (idx >= 0) {
      let raw = args.slice(idx + pattern.length);
      if (raw.endsWith('"}')) raw = raw.slice(0, -2);
      else if (raw.endsWith('"')) raw = raw.slice(0, -1);
      return raw
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    }
  }
  return null;
}

/**
 * Register a confirm tool id so that subsequent onToolResult/onDenied
 * can find it by tool name.
 */
export function registerConfirmToolId(toolName: string, id: string): void {
  activeToolIds.set(toolName, id);
}

/**
 * Creates AgentCallbacks that dispatch to TUI state.
 */
export function createBridgeCallbacks(dispatch: Dispatch<TuiAction>): AgentCallbacks & { _stopBatcher: () => void } {
  const contentBatcher = createTokenBatcher(dispatch, 'APPEND_CONTENT');
  const thoughtBatcher = createTokenBatcher(dispatch, 'APPEND_THOUGHT');
  
  let inThink = false;
  let tagBuffer = '';

  activeToolIds = new Map();
  streamingToolIds = new Map();
  lastStreamingArgs = new Map();
  toolCallCounter = 0;

  let streamingThrottleTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingStreamingUpdate: (() => void) | null = null;

  function flushStreamingUpdate() {
    if (pendingStreamingUpdate) {
      pendingStreamingUpdate();
      pendingStreamingUpdate = null;
    }
    if (streamingThrottleTimer) {
      clearTimeout(streamingThrottleTimer);
      streamingThrottleTimer = null;
    }
  }

  return {
    onContent: (text: string) => {
      for (let i = 0; i < text.length; i++) {
        const ch = text[i]!;

        if (tagBuffer.length > 0 || ch === '<') {
          tagBuffer += ch;
          if (tagBuffer === '<think>') {
            contentBatcher.flush();
            inThink = true;
            tagBuffer = '';
            continue;
          } else if (tagBuffer === '</think>') {
            thoughtBatcher.flush();
            inThink = false;
            tagBuffer = '';
            continue;
          } else if (!'<think>'.startsWith(tagBuffer) && !'</think>'.startsWith(tagBuffer)) {
            if (inThink) {
              thoughtBatcher.append(tagBuffer);
            } else {
              contentBatcher.append(tagBuffer);
            }
            tagBuffer = '';
          }
          continue;
        }

        if (inThink) {
          thoughtBatcher.append(ch);
        } else {
          contentBatcher.append(ch);
        }
      }
    },

    onToolCallStreaming: (index: number, name: string, accumulatedArgs: string) => {
      if (!streamingToolIds.has(index)) {
        contentBatcher.flush();
        thoughtBatcher.flush();
        const id = `tool-${++toolCallCounter}`;
        streamingToolIds.set(index, id);
        activeToolIds.set(name, id);
        dispatch({ type: 'TOOL_STREAMING', id, name, streamingContent: '0' });
      }
      const id = streamingToolIds.get(index)!;
      lastStreamingArgs.set(id, accumulatedArgs);
      const lineCount = (accumulatedArgs.match(/\\n/g) || []).length;

      pendingStreamingUpdate = () => {
        dispatch({ type: 'TOOL_STREAMING', id, name, streamingContent: String(lineCount) });
      };
      if (!streamingThrottleTimer) {
        streamingThrottleTimer = setTimeout(() => {
          flushStreamingUpdate();
        }, 80);
      }
    },

    onToolExecuting: (name: string, params: Record<string, unknown>) => {
      flushStreamingUpdate();
      contentBatcher.flush();
      thoughtBatcher.flush();
      contentBatcher.pause();
      thoughtBatcher.pause();
      const existingId = activeToolIds.get(name);
      const id = existingId || `tool-${++toolCallCounter}`;
      activeToolIds.set(name, id);
      dispatch({ type: 'TOOL_EXECUTING', id, name, params });
    },

    onToolResult: (name: string, result: string, truncated: boolean) => {
      const id = activeToolIds.get(name) || `tool-${++toolCallCounter}`;
      const lines = result.split('\n');
      const isWriteTool = name === 'write-file' || name === 'edit-file';
      let summary: string;
      if (isWriteTool) {
        const code = extractCodeFromArgs(name, lastStreamingArgs.get(id) || '');
        const codeLines = code ? code.split('\n').length : 0;
        summary = codeLines > 0 ? `${codeLines} lines` : (truncated ? 'truncated' : `${lines.length} lines`);
      } else {
        summary = truncated ? `truncated` : `${lines.length} lines`;
      }

      const preview = lines.slice(0, 5).join('\n').slice(0, 200);
      const resultContent = lines.length > 5 || preview.length >= 200
        ? preview + '...'
        : preview;
      dispatch({ type: 'TOOL_RESULT', id, resultSummary: summary, resultContent });
    },

    onDenied: (toolName: string, feedback?: string) => {
      const id = activeToolIds.get(toolName) || `tool-${++toolCallCounter}`;
      dispatch({ type: 'TOOL_DENIED', id, feedback });
    },

    onError: (err: Error) => {
      contentBatcher.stop();
      thoughtBatcher.stop();
      dispatch({ type: 'SET_ERROR', error: err.message });
    },

    _stopBatcher: () => {
      contentBatcher.stop();
      thoughtBatcher.stop();
    },
  };
}
