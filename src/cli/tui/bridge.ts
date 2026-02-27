// Bridge: Agent callbacks → TUI dispatch
// Includes token batching to avoid excessive React re-renders

import type { Dispatch } from 'react';
import type { AgentCallbacks } from '../../core/agent.js';
import type { TuiAction } from './state.js';
import { progressStore } from './stores/progressStore.js';

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
 * Creates a unified action batcher that collects dispatches and flushes them
 * at a fixed interval to minimize terminal flickering and React re-renders.
 */
function createActionBatcher(dispatch: Dispatch<TuiAction>) {
  let pendingActions: Map<string, TuiAction> = new Map();
  let timer: ReturnType<typeof setInterval> | null = null;

  function flush() {
    if (pendingActions.size > 0) {
      const actions = Array.from(pendingActions.values());
      pendingActions.clear();
      dispatch({ type: 'BATCH', actions });
    }
  }

  function start() {
    if (!timer) {
      timer = setInterval(flush, 200); // Optimized for smoothness
    }
  }

  function stop() {
    flush();
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function queue(key: string, action: TuiAction) {
    if (action.type === 'APPEND_CONTENT' || action.type === 'APPEND_THOUGHT') {
      const existing = pendingActions.get(key) as any;
      if (existing) {
        action = { ...action, text: existing.text + (action as any).text } as TuiAction;
      }
    }
    pendingActions.set(key, action);
    start();
  }

  return { queue, stop, flush };
}

// Track tool call IDs for mapping tool results back
let toolCallCounter = 0;
let activeToolIds: Map<string, string> = new Map();
// Track streaming tool index → id
let streamingToolIds: Map<number, string> = new Map();
// Track last streaming value per tool id to avoid redundant updates
let lastStreamingValues: Map<string, string> = new Map();

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
  const batcher = createActionBatcher(dispatch);
  
  let inThink = false;
  let tagBuffer = '';

  activeToolIds = new Map();
  streamingToolIds = new Map();
  lastStreamingValues = new Map();
  toolCallCounter = 0;

  return {
    onContent: (text: string) => {
      let contentAcc = '';
      let thoughtAcc = '';

      for (let i = 0; i < text.length; i++) {
        const ch = text[i]!;

        if (tagBuffer.length > 0 || ch === '<') {
          tagBuffer += ch;
          if (tagBuffer === '<think>') {
            if (contentAcc) batcher.queue('content', { type: 'APPEND_CONTENT', text: contentAcc });
            contentAcc = '';
            batcher.flush();
            inThink = true;
            tagBuffer = '';
            continue;
          } else if (tagBuffer === '</think>') {
            if (thoughtAcc) batcher.queue('thought', { type: 'APPEND_THOUGHT', text: thoughtAcc });
            thoughtAcc = '';
            batcher.flush();
            inThink = false;
            tagBuffer = '';
            continue;
          } else if (!'<think>'.startsWith(tagBuffer) && !'</think>'.startsWith(tagBuffer)) {
            if (inThink) thoughtAcc += tagBuffer;
            else contentAcc += tagBuffer;
            tagBuffer = '';
          }
          continue;
        }

        if (inThink) thoughtAcc += ch;
        else contentAcc += ch;
      }

      if (thoughtAcc) batcher.queue('thought', { type: 'APPEND_THOUGHT', text: thoughtAcc });
      if (contentAcc) batcher.queue('content', { type: 'APPEND_CONTENT', text: contentAcc });
    },

    onToolCallStreaming: (index: number, name: string, accumulatedArgs: string) => {
      if (!streamingToolIds.has(index)) {
        batcher.flush();
        const id = `tool-${++toolCallCounter}`;
        streamingToolIds.set(index, id);
        activeToolIds.set(name, id);
        lastStreamingValues.set(id, '0');
        // Still queue the action to ensure the block is created in the history, but it won't update repeatedly
        batcher.queue(`tool-${id}`, { type: 'TOOL_STREAMING', id, name, streamingContent: '0' });
      }
      
      const id = streamingToolIds.get(index)!;
      const lineCount = (accumulatedArgs.match(/\\n/g) || []).length;
      const streamingContent = String(lineCount);

      if (lastStreamingValues.get(id) !== streamingContent) {
        lastStreamingValues.set(id, streamingContent);
        // CRITICAL: Update the offline store directly
        progressStore.update({ name, progress: `${streamingContent} lines` });
      }
    },

    onToolExecuting: (name: string, params: Record<string, unknown>) => {
      progressStore.update(undefined); // Clear progress when tool starts execution
      batcher.flush();
      const existingId = activeToolIds.get(name);
      const id = existingId || `tool-${++toolCallCounter}`;
      activeToolIds.set(name, id);
      lastStreamingValues.set(id, JSON.stringify(params));
      dispatch({ type: 'TOOL_EXECUTING', id, name, params });
    },

    onToolResult: (name: string, result: string, truncated: boolean) => {
      progressStore.update(undefined); // Clear progress on result
      batcher.flush();
      const id = activeToolIds.get(name) || `tool-${++toolCallCounter}`;
      const lines = result.split('\n');
      const isWriteTool = name === 'write-file' || name === 'edit-file';
      let summary: string;
      if (isWriteTool) {
        const stored = lastStreamingValues.get(id) || '';
        const code = extractCodeFromArgs(name, stored);
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
      batcher.flush();
      const id = activeToolIds.get(toolName) || `tool-${++toolCallCounter}`;
      dispatch({ type: 'TOOL_DENIED', id, feedback });
    },

    onError: (err: Error) => {
      batcher.stop();
      dispatch({ type: 'SET_ERROR', error: err.message });
    },

    _stopBatcher: () => {
      batcher.stop();
    },
  };
}
