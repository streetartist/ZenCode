import type { ZenCodeConfig } from '../../config/types.js';
import type { Message, ToolDefinition } from '../../llm/types.js';
import type { LLMClient } from '../../llm/client.js';
import type { ToolRegistry } from '../../tools/registry.js';
import type { AgentCallbacks } from '../agent.js';
import type { MemoStore } from '../memo-store.js';
import { Conversation } from '../conversation.js';
import { confirmExecution } from '../../tools/permission.js';
import { autoMemoForTool } from '../auto-memo.js';
import { ReadTracker } from '../read-tracker.js';

/**
 * Agent B - 编码者
 *
 * 短生命周期：每次任务创建新会话，避免累积上下文
 * 根据协作模式，可能有工具也可能没有
 */
export class Coder {
  private client: LLMClient;
  private registry: ToolRegistry;
  private config: ZenCodeConfig;
  private systemPrompt: string;
  private tools: ToolDefinition[];
  private memoStore?: MemoStore;

  constructor(
    client: LLMClient,
    registry: ToolRegistry,
    config: ZenCodeConfig,
    systemPrompt: string,
    tools: ToolDefinition[],
    memoStore?: MemoStore,
  ) {
    this.client = client;
    this.registry = registry;
    this.config = config;
    this.systemPrompt = systemPrompt;
    this.tools = tools;
    this.memoStore = memoStore;
  }

  /**
   * 执行编码任务（短生命周期，每次新建会话）
   *
   * @param taskMessage 调度者发来的任务描述（作为 user message）
   * @param callbacks 回调
   * @returns 编码者的最终响应
   */
  async execute(taskMessage: string, callbacks: AgentCallbacks = {}): Promise<string> {
    const conversation = new Conversation();
    conversation.setSystemPrompt(this.systemPrompt);
    conversation.addUserMessage(taskMessage);

    const readTracker = new ReadTracker();
    let lastContent = '';

    while (true) {

      const assistantMsg = await this.client.chatStream(
        conversation.getMessages(),
        this.tools.length > 0 ? this.tools : undefined,
        callbacks,
      );

      conversation.addAssistantMessage(assistantMsg);

      // 无工具调用 → 结束
      if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
        lastContent = assistantMsg.content || '';
        break;
      }

      // 有工具 → 执行工具循环（autonomous 模式）
      for (const toolCall of assistantMsg.tool_calls) {
        const toolName = toolCall.function.name;
        let params: Record<string, unknown>;
        try {
          params = JSON.parse(toolCall.function.arguments);
        } catch {
          conversation.addToolResult(toolCall.id, '参数解析失败：无效的 JSON');
          continue;
        }

        try {
          // 先读后改：edit-file 必须先 read-file
          if (toolName === 'edit-file') {
            const editPath = params['path'] as string;
            if (!readTracker.hasRead(editPath)) {
              conversation.addToolResult(toolCall.id,
                `⚠ 禁止编辑未读取的文件。请先 read-file "${editPath}" 了解当前内容，再 edit-file。`);
              continue;
            }
          }

          // write-file 覆盖检查：文件已存在时需要 overwrite: true
          if (toolName === 'write-file') {
            const warn = readTracker.checkWriteOverwrite(
              params['path'] as string,
              params['overwrite'] as boolean | undefined,
            );
            if (warn) {
              conversation.addToolResult(toolCall.id, warn);
              continue;
            }
          }

          const permLevel = this.registry.getPermissionLevel(toolName);
          if (permLevel === 'deny') {
            callbacks.onDenied?.(toolName);
            conversation.addToolResult(toolCall.id, `工具 "${toolName}" 已被禁止执行`);
            continue;
          }

          if (permLevel === 'auto') {
            callbacks.onToolExecuting?.(toolName, params);
          }

          if (permLevel === 'confirm') {
            const confirmResult = await confirmExecution(toolName, params);
            if (!confirmResult.approved) {
              callbacks.onDenied?.(toolName, confirmResult.feedback);
              const denyMsg = confirmResult.feedback
                ? `用户拒绝了此操作，用户反馈: ${confirmResult.feedback}`
                : '用户拒绝了此操作';
              conversation.addToolResult(toolCall.id, denyMsg);
              continue;
            }
          }

          const result = await this.registry.execute(toolName, params, this.config.max_tool_output);
          callbacks.onToolResult?.(toolName, result.content, result.truncated ?? false);
          autoMemoForTool(this.memoStore, toolName, params, result.content);

          // 跟踪已读/已写文件
          if (toolName === 'read-file') {
            readTracker.markRead(params['path'] as string);
          } else if (toolName === 'write-file') {
            readTracker.markWritten(params['path'] as string);
          }

          conversation.addToolResult(toolCall.id, result.content);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          conversation.addToolResult(toolCall.id, `工具执行异常：${msg}`);
        }
      }

      if (assistantMsg.content) {
        lastContent = assistantMsg.content;
      }
    }

    return lastContent;
  }
}
