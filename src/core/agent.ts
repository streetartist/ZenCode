import type { ZenCodeConfig } from '../config/types.js';
import type { Message, ToolDefinition } from '../llm/types.js';
import type { LLMClient, StreamCallbacks } from '../llm/client.js';
import type { ToolRegistry } from '../tools/registry.js';
import { confirmExecution } from '../tools/permission.js';
import { Conversation } from './conversation.js';
import { ReadTracker } from './read-tracker.js';

export interface AgentCallbacks extends StreamCallbacks {
  onToolExecuting?: (toolName: string, params: Record<string, unknown>) => void;
  onToolResult?: (toolName: string, result: string, truncated: boolean) => void;
  onDenied?: (toolName: string, feedback?: string) => void;
}

/**
 * 单 Agent 循环
 *
 * 消息流程：
 * 用户输入 → 构建消息 → LLM (带tools) → 处理响应
 *   ├─ 含工具调用 → 执行工具 → 结果加入历史 → 回到 LLM
 *   └─ 纯文本响应 → 返回
 */
export class Agent {
  private conversation: Conversation;
  private client: LLMClient;
  private registry: ToolRegistry;
  private config: ZenCodeConfig;
  private fixedTools?: ToolDefinition[];
  private readTracker = new ReadTracker();
  private interrupted = false;

  constructor(
    client: LLMClient,
    registry: ToolRegistry,
    config: ZenCodeConfig,
    systemPrompt: string,
    tools?: ToolDefinition[],
  ) {
    this.client = client;
    this.registry = registry;
    this.config = config;
    this.conversation = new Conversation();
    this.conversation.setSystemPrompt(systemPrompt);
    this.fixedTools = tools;
  }

  /**
   * 执行一轮完整的 agent 循环
   */
  async run(userMessage: string, callbacks: AgentCallbacks = {}): Promise<string> {
    this.interrupted = false;
    // 新一轮对话：清除历史中的 reasoning_content（deepseek-reasoner 兼容）
    this.conversation.clearReasoningContent();
    this.conversation.addUserMessage(userMessage);

    let lastContent = '';

    while (true) {
      if (this.interrupted) break;
      // 每轮动态获取工具列表，确保 /parallel /todo 等切换生效
      const tools = this.fixedTools || this.registry.toToolDefinitions();

      // 调用 LLM
      const assistantMsg = await this.client.chatStream(
        this.conversation.getMessages(),
        tools.length > 0 ? tools : undefined,
        callbacks,
      );

      // 过滤并处理工具调用
      const validToolCalls: typeof assistantMsg.tool_calls = [];
      const invalidToolCalls: typeof assistantMsg.tool_calls = [];
      if (assistantMsg.tool_calls) {
        for (const toolCall of assistantMsg.tool_calls) {
          try {
            JSON.parse(toolCall.function.arguments);
            validToolCalls.push(toolCall);
          } catch {
            invalidToolCalls.push(toolCall);
          }
        }
      }

      // 更新消息中的工具调用为仅包含合法 JSON 的调用，避免后续请求 400 错误
      assistantMsg.tool_calls = validToolCalls.length > 0 ? validToolCalls : undefined;
      this.conversation.addAssistantMessage(assistantMsg);

      // 对于无效的工具调用，通知 UI 显示错误，但不加入对话历史
      for (const toolCall of invalidToolCalls) {
        callbacks.onToolResult?.(toolCall.function.name, `参数解析失败：无效的 JSON 字符串\n${toolCall.function.arguments}`, false);
      }

      // 如果没有有效的工具调用，结束循环
      if (validToolCalls.length === 0) {
        lastContent = assistantMsg.content || '';
        break;
      }

      // 执行所有有效的工具调用
      for (const toolCall of validToolCalls) {
        if (this.interrupted) break;
        const toolName = toolCall.function.name;
        // 此时 JSON.parse 必然成功
        const params: Record<string, unknown> = JSON.parse(toolCall.function.arguments);

        try {
          // 先读后改：edit-file 必须先 read-file
          if (toolName === 'edit-file') {
            const editPath = params['path'] as string;
            if (!this.readTracker.hasRead(editPath)) {
              this.conversation.addToolResult(toolCall.id,
                `⚠ 禁止编辑未读取的文件。请先 read-file "${editPath}" 了解当前内容，再 edit-file。`);
              continue;
            }
          }

          // write-file 覆盖检查：文件已存在时需要 overwrite: true
          if (toolName === 'write-file') {
            const warn = this.readTracker.checkWriteOverwrite(
              params['path'] as string,
              params['overwrite'] as boolean | undefined,
            );
            if (warn) {
              this.conversation.addToolResult(toolCall.id, warn);
              continue;
            }
          }

          // 权限检查
          const permLevel = this.registry.getPermissionLevel(toolName);
          if (permLevel === 'deny') {
            callbacks.onDenied?.(toolName);
            this.conversation.addToolResult(toolCall.id, `工具 "${toolName}" 已被禁止执行`);
            continue;
          }

          // 自动执行的工具直接显示并执行
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
              this.conversation.addToolResult(toolCall.id, denyMsg);
              continue;
            }
          }

          // 执行工具
          const result = await this.registry.execute(toolName, params, this.config.max_tool_output);
          callbacks.onToolResult?.(toolName, result.content, result.truncated ?? false);

          // 跟踪已读/已写文件
          if (toolName === 'read-file') {
            this.readTracker.markRead(params['path'] as string);
          } else if (toolName === 'write-file') {
            this.readTracker.markWritten(params['path'] as string);
          }

          this.conversation.addToolResult(toolCall.id, result.content);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.conversation.addToolResult(toolCall.id, `工具执行异常：${msg}`);
        }
      }

      // 记录最后的文本内容
      if (assistantMsg.content) {
        lastContent = assistantMsg.content;
      }
    }

    return lastContent;
  }

  interrupt(): void {
    this.interrupted = true;
    this.client.abortActiveStream();
  }

  /**
   * 获取对话历史
   */
  getConversation(): Conversation {
    return this.conversation;
  }
}
