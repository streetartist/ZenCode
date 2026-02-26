import type { ZenCodeConfig } from '../../config/types.js';
import type { LLMClient } from '../../llm/client.js';
import type { ToolRegistry } from '../../tools/registry.js';
import type { AgentCallbacks } from '../agent.js';
import type { SubAgentConfig } from './types.js';
import type { SubAgentTracker } from '../sub-agent-tracker.js';
import { Conversation } from '../conversation.js';
import { confirmExecution } from '../../tools/permission.js';
import { ReadTracker } from '../read-tracker.js';

const DEFAULT_MAX_TURNS = 15;

/**
 * SubAgentRunner - 执行可配置子 Agent
 *
 * 基于 SubAgentConfig 运行子 Agent。
 * 使用流式 chatStream()，TUI 可实时显示输出。
 */
export class SubAgentRunner {
  private client: LLMClient;
  private registry: ToolRegistry;
  private config: ZenCodeConfig;
  private agentConfig: SubAgentConfig;
  private tracker?: SubAgentTracker;

  constructor(
    client: LLMClient,
    registry: ToolRegistry,
    config: ZenCodeConfig,
    agentConfig: SubAgentConfig,
    tracker?: SubAgentTracker,
  ) {
    this.client = client;
    this.registry = registry;
    this.config = config;
    this.agentConfig = agentConfig;
    this.tracker = tracker;
  }

  /**
   * 执行子 Agent 任务
   */
  async execute(task: string, context?: string, callbacks: AgentCallbacks = {}): Promise<string> {
    const timeoutMs = (this.agentConfig.timeout ?? 120) * 1000;
    const maxTurns = this.agentConfig.max_turns ?? DEFAULT_MAX_TURNS;

    return Promise.race([
      this.run(task, context, maxTurns, callbacks),
      this.timeout(timeoutMs),
    ]);
  }

  private timeout(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error(`子 Agent "${this.agentConfig.name}" 超时（${ms / 1000}s）`)),
        ms,
      );
    });
  }

  private async run(task: string, context: string | undefined, maxTurns: number, callbacks: AgentCallbacks): Promise<string> {
    const conversation = new Conversation();
    const readTracker = new ReadTracker();

    conversation.setSystemPrompt(this.agentConfig.prompt);

    // 组装任务消息
    let taskMessage = task;
    if (context) {
      taskMessage += `\n\n[上下文]\n${context}`;
    }
    conversation.addUserMessage(taskMessage);

    // 构建工具列表：取子 Agent 声明的工具与注册表的交集
    const tools = this.registry.toToolDefinitions(this.agentConfig.tools);
    let lastContent = '';

    for (let turn = 0; turn < maxTurns; turn++) {
      const assistantMsg = await this.client.chatStream(
        conversation.getMessages(),
        tools.length > 0 ? tools : undefined,
        callbacks,
      );

      // 报告 token 用量
      if (assistantMsg.usage && this.tracker) {
        this.tracker.addTokens(assistantMsg.usage.total_tokens);
      }

      conversation.addAssistantMessage(assistantMsg);

      if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
        lastContent = assistantMsg.content || '';
        break;
      }

      for (const toolCall of assistantMsg.tool_calls) {
        const toolName = toolCall.function.name;

        // 检查工具是否在子 Agent 允许列表中
        if (!this.agentConfig.tools.includes(toolName)) {
          conversation.addToolResult(
            toolCall.id,
            `子 Agent "${this.agentConfig.name}" 不允许使用工具 "${toolName}"`,
          );
          continue;
        }

        let params: Record<string, unknown>;
        try {
          params = JSON.parse(toolCall.function.arguments);
        } catch {
          conversation.addToolResult(toolCall.id, '参数解析失败：无效的 JSON');
          continue;
        }

        try {
          // 先读后改检查
          if (toolName === 'edit-file') {
            const editPath = params['path'] as string;
            if (!readTracker.hasRead(editPath)) {
              conversation.addToolResult(toolCall.id,
                `⚠ 禁止编辑未读取的文件。请先 read-file "${editPath}" 了解当前内容，再 edit-file。`);
              continue;
            }
          }

          // write-file 覆盖检查
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

          // 权限检查
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

          // 执行工具
          const result = await this.registry.execute(toolName, params, this.config.max_tool_output);
          callbacks.onToolResult?.(toolName, result.content, result.truncated ?? false);

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
