import type { ZenCodeConfig } from '../config/types.js';
import type { LLMClient } from '../llm/client.js';
import type { ToolRegistry } from '../tools/registry.js';
import { Conversation } from './conversation.js';
import { ReadTracker } from './read-tracker.js';

const DEFAULT_TIMEOUT_MS = 120_000; // 2 minutes

/**
 * 轻量子 Agent - 独立对话，只读工具，非流式
 *
 * 用于并行执行多个子任务（如同时读多个文件、搜索多处代码）
 */
export class SubAgent {
  private client: LLMClient;
  private registry: ToolRegistry;
  private config: ZenCodeConfig;
  private task: string;
  private allowedTools: string[];
  private maxTurns: number;
  private timeoutMs: number;

  constructor(
    client: LLMClient,
    registry: ToolRegistry,
    config: ZenCodeConfig,
    task: string,
    allowedTools: string[] = ['read-file', 'glob', 'grep'],
    maxTurns: number = 10,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {
    this.client = client;
    this.registry = registry;
    this.config = config;
    this.task = task;
    // 禁止递归：排除 spawn-agents 和 todo
    this.allowedTools = allowedTools.filter((t) => t !== 'spawn-agents' && t !== 'todo');
    this.maxTurns = Math.min(maxTurns, 15);
    this.timeoutMs = timeoutMs;
  }

  async run(): Promise<string> {
    return Promise.race([
      this.execute(),
      this.timeout(),
    ]);
  }

  private timeout(): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error(`子 Agent 超时（${this.timeoutMs / 1000}s）`)),
        this.timeoutMs,
      );
    });
  }

  private async execute(): Promise<string> {
    const conversation = new Conversation();
    const readTracker = new ReadTracker();

    const systemPrompt = `你是 ZenCode 子 Agent。你的任务：${this.task}\n完成后直接返回结果，不要多余解释。`;

    conversation.setSystemPrompt(systemPrompt);
    conversation.addUserMessage(this.task);

    const tools = this.registry.toToolDefinitions(this.allowedTools);
    let lastContent = '';

    for (let turn = 0; turn < this.maxTurns; turn++) {
      const assistantMsg = await this.client.chat(
        conversation.getMessages(),
        tools.length > 0 ? tools : undefined,
      );

      conversation.addAssistantMessage(assistantMsg);

      if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
        lastContent = assistantMsg.content || '';
        break;
      }

      for (const toolCall of assistantMsg.tool_calls) {
        const toolName = toolCall.function.name;

        if (!this.allowedTools.includes(toolName)) {
          conversation.addToolResult(
            toolCall.id,
            `子 Agent 不允许使用工具 "${toolName}"`,
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

          const result = await this.registry.execute(
            toolName,
            params,
            this.config.max_tool_output,
          );

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
