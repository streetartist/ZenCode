import type { ZenCodeConfig, CollaborationMode } from '../../config/types.js';
import type { Message, ToolDefinition } from '../../llm/types.js';
import { LLMClient, createLLMClient } from '../../llm/client.js';
import type { ToolRegistry } from '../../tools/registry.js';
import type { AgentCallbacks } from '../agent.js';
import type { MemoStore } from '../memo-store.js';
import { resolveModelConfig } from '../../config/loader.js';
import { Conversation } from '../conversation.js';
import { confirmExecution } from '../../tools/permission.js';
import { Coder } from './coder.js';
import { getMode } from './modes.js';
import { autoMemoForTool } from '../auto-memo.js';
import { ReadTracker } from '../read-tracker.js';

/**
 * 调度者发给编码者的内部工具
 * 在 delegated 和 controlled 模式下，调度者通过此工具与编码者通信
 */
const SEND_TO_CODER_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'send-to-coder',
    description: '将一个原子编码任务发送给编码 Agent。每次只发一个具体步骤（1-3 个文件），多步骤任务请分多次调用。',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: '任务描述：做什么 + 目标文件路径 + 具体要求',
        },
        context: {
          type: 'string',
          description: '编码所需的关键上下文：依赖关系、命名约定、需引用的函数名和 memo key',
        },
      },
      required: ['task'],
    },
  },
};

export interface OrchestratorCallbacks extends AgentCallbacks {
  onCoderStart?: () => void;
  onCoderEnd?: (response: string) => void;
  onModeInfo?: (mode: CollaborationMode) => void;
}

/**
 * Agent A - 调度者（Orchestrator）
 *
 * 职责：
 * - 接收系统提示词和工具定义
 * - 理解用户意图，收集上下文
 * - 将任务转化为纯净的编码指令
 * - 管理权限和对话历史
 */
export class Orchestrator {
  private conversation: Conversation;
  private orchestratorClient: LLMClient;
  private coderClient: LLMClient;
  private registry: ToolRegistry;
  private config: ZenCodeConfig;
  private mode: CollaborationMode;
  private baseSystemPrompt: string;
  private memoStore?: MemoStore;
  private readTracker = new ReadTracker();
  private interrupted = false;

  constructor(
    registry: ToolRegistry,
    config: ZenCodeConfig,
    systemPrompt: string,
    memoStore?: MemoStore,
  ) {
    this.registry = registry;
    this.config = config;
    this.mode = config.collaboration;
    this.baseSystemPrompt = systemPrompt;
    this.memoStore = memoStore;

    // 创建调度者的 LLM 客户端
    const orchConfig = resolveModelConfig(config, 'orchestrator');
    this.orchestratorClient = createLLMClient({
      apiKey: orchConfig.api_key,
      baseURL: orchConfig.base_url,
      model: orchConfig.model,
      temperature: orchConfig.temperature,
      maxTokens: orchConfig.max_tokens,
    });

    // 创建编码者的 LLM 客户端
    const coderConfig = resolveModelConfig(config, 'coder');
    this.coderClient = createLLMClient({
      apiKey: coderConfig.api_key,
      baseURL: coderConfig.base_url,
      model: coderConfig.model,
      temperature: coderConfig.temperature,
      maxTokens: coderConfig.max_tokens,
    });

    this.conversation = new Conversation();
    this.conversation.setSystemPrompt(this.buildSystemPrompt());
  }

  /**
   * 动态获取调度者的工具列表：注册表工具 + send-to-coder
   */
  private getTools(): ToolDefinition[] {
    return [
      ...this.registry.toToolDefinitions(),
      SEND_TO_CODER_TOOL,
    ];
  }

  /**
   * 构建调度者的系统提示词（包含当前协作模式）
   */
  private buildSystemPrompt(): string {
    const modeInfo = getMode(this.mode);
    return `${this.baseSystemPrompt}

# 你是调度者 Agent

协作模式：${modeInfo.name} - ${modeInfo.description}

你是侦察兵 + 指挥官。你自己不写代码，你的职责是：收集情报 → 规划步骤 → 逐步委派编码 Agent。

## 核心流程

1. **评估任务**
   - 单文件独立任务 → 收集后一次委派
   - 多文件关联任务 → 拆分为多步，按依赖顺序逐步委派

2. **收集上下文**（高效，不重复）
   - glob/grep 定位 → read-file 或 spawn-agents 并行读取
   - 需要了解已有文件细节？→ memo read file:路径 查看完整内容

3. **记录分析结论**（⭐ 关键步骤）
   委派前用 memo write 记录：
   - 跨文件依赖关系（如"A.js 导出 X，B.js 需导入 X"）
   - 命名约定（如"项目用 camelCase，CSS 用 kebab-case"）
   - 架构决策（如"选用 Flask + Jinja2 模板"）
   key 建议用 plan:xxx 格式，如 plan:architecture

4. **逐步委派编码**：send-to-coder
   任务描述格式：
   [目标] 做什么（一句话）
   [文件] 目标文件路径
   [要求] 命名、格式、接口约束
   [参考] memo 中相关 key（coder 可 memo read 查看）

   拆分规则：
   - 基础模块/工具函数 → 先做
   - 依赖基础模块的页面/组件 → 后做
   - 每次只发一个原子任务（1-3 个文件）

5. **迭代/验证**
   - 每步完成后检查 memo 确认结果（自动记录的导出名是否正确）
   - 发现问题 → 再次 send-to-coder 修复
   - 需要时用 bash 执行构建/测试验证

## 重要

- memo 中 file:路径 条目存储了文件完整内容，可随时 memo read 查看
- 编码 Agent 完成任务后会 memo write 文件摘要（含导出的函数名等）
- 每步完成后检查 memo 确认结果，了解 coder 创建了什么
- 不要重复探索（glob 查过的目录不要再 bash 列目录）
- bash 用于执行命令（构建、测试），不需要委派
- 完成所有步骤后简要告知用户结果`;
  }

  /**
   * 切换协作模式
   */
  setMode(mode: CollaborationMode): void {
    this.mode = mode;
    this.conversation.setSystemPrompt(this.buildSystemPrompt());
  }

  /**
   * 执行用户请求
   */
  async run(userMessage: string, callbacks: OrchestratorCallbacks = {}): Promise<string> {
    this.interrupted = false;
    callbacks.onModeInfo?.(this.mode);
    this.conversation.addUserMessage(userMessage);

    let lastContent = '';

    while (true) {
      if (this.interrupted) break;
      const tools = this.getTools();

      const assistantMsg = await this.orchestratorClient.chatStream(
        this.conversation.getMessages(),
        tools,
        callbacks,
      );

      this.conversation.addAssistantMessage(assistantMsg);

      // 无工具调用 → 结束
      if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
        lastContent = assistantMsg.content || '';
        break;
      }

      // 处理工具调用
      for (const toolCall of assistantMsg.tool_calls) {
        if (this.interrupted) break;
        const toolName = toolCall.function.name;
        let params: Record<string, unknown>;
        try {
          params = JSON.parse(toolCall.function.arguments);
        } catch {
          this.conversation.addToolResult(toolCall.id, '参数解析失败：无效的 JSON');
          continue;
        }

        try {
          // 特殊处理 send-to-coder
          if (toolName === 'send-to-coder') {
            const task = params['task'] as string;
            const context = params['context'] as string | undefined;
            const coderResponse = await this.invokeCoder(task, context, callbacks);
            this.conversation.addToolResult(toolCall.id, coderResponse);
            continue;
          }

          // 普通工具权限检查与执行
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

          const permLevel = this.registry.getPermissionLevel(toolName);
          if (permLevel === 'deny') {
            callbacks.onDenied?.(toolName);
            this.conversation.addToolResult(toolCall.id, `工具 "${toolName}" 已被禁止执行`);
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
              this.conversation.addToolResult(toolCall.id, denyMsg);
              continue;
            }
          }

          const result = await this.registry.execute(toolName, params, this.config.max_tool_output);
          callbacks.onToolResult?.(toolName, result.content, result.truncated ?? false);
          autoMemoForTool(this.memoStore, toolName, params, result.content);

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

      if (assistantMsg.content) {
        lastContent = assistantMsg.content;
      }
    }

    return lastContent;
  }

  /**
   * 调用编码者 Agent
   */
  private async invokeCoder(task: string, context: string | undefined, callbacks: OrchestratorCallbacks): Promise<string> {
    if (this.interrupted) return '';
    callbacks.onCoderStart?.();

    const modeInfo = getMode(this.mode);

    // 构建编码者的工具列表
    let coderTools: ToolDefinition[] = [];
    if (modeInfo.coderHasTools && modeInfo.coderToolNames) {
      coderTools = this.registry.toToolDefinitions(modeInfo.coderToolNames);
    }

    // 自动注入 context + memo 索引 + 边界提醒
    let taskWithMemo = task;
    if (context) {
      taskWithMemo += `\n\n[调度者补充上下文]\n${context}`;
    }
    if (this.memoStore) {
      const index = this.memoStore.buildIndex();
      if (index) {
        taskWithMemo += `\n\n[共享备忘录]\n${index}`;
      }
    }
    taskWithMemo += '\n\n[重要：立即开始编码，不要探索，不要输出分析]';

    const coder = new Coder(
      this.coderClient,
      this.registry,
      this.config,
      modeInfo.coderSystemPrompt,
      coderTools,
      this.memoStore,
    );

    const response = await coder.execute(taskWithMemo, {
      onContent: callbacks.onContent,
      onToolCallStreaming: callbacks.onToolCallStreaming,
      onToolExecuting: callbacks.onToolExecuting,
      onToolResult: callbacks.onToolResult,
      onDenied: callbacks.onDenied,
    });

    callbacks.onCoderEnd?.(response);
    return response;
  }

  interrupt(): void {
    this.interrupted = true;
    this.orchestratorClient.abortActiveStream();
    this.coderClient.abortActiveStream();
  }

  /**
   * 获取对话历史
   */
  getConversation(): Conversation {
    return this.conversation;
  }
}
