# ZenCode 设计文档

## 概述

ZenCode 是一个极简的 CLI AI 编程工具，核心理念是「用最少的提示词，让模型把全部能力集中在编程本身」。

### 设计目标

1. **最小认知负担** — 用户只需告诉 AI 要做什么，AI 自动完成收集上下文、编写代码、验证结果
2. **高效的 Agent 协作** — 通过 memo 作为共享记忆，实现 Orchestrator 与 Coder 的高效配合
3. **优秀的终端体验** — 全屏 TUI，支持流式输出、实时进度、工具确认
4. **编码安全** — 强制先读后改、覆盖确认，避免意外破坏代码

### 核心架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         用户 (User)                             │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                     CLI 入口 (bin/zencode.ts)                   │
│                  createCli() → program.parse()                  │
└────────────────────────────┬────────────────────────────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        ┌─────────┐   ┌──────────┐   ┌──────────┐
        │ TUI 模式 │   │ 单次执行 │   │ 简单REPL │
        │(默认)   │   │ 模式     │   │ 模式     │
        └────┬────┘   └────┬─────┘   └────┬─────┘
             │             │              │
             └─────────────┼──────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Agent 层 (src/core/)                         │
│  ┌───────────────┐         ┌────────────────┐                  │
│  │   Agent       │◄──────►│ Orchestrator    │                  │
│  │  (单Agent)    │         │ (双Agent调度者) │                  │
│  └───────┬───────┘         └───────┬────────┘                  │
│          │                         │                           │
│          │    ┌────────────────────┘                           │
│          │    ▼                                                │
│          │  ┌────────────────┐                                 │
│          │  │    Coder       │                                 │
│          │  │ (双Agent执行者) │                                 │
│          │  └────────────────┘                                 │
│          │                                                     │
│  ┌───────┴────────────┐                                        │
│  │ ReadTracker        │  先读后改 / 覆盖保护                   │
│  │ MemoStore          │  共享备忘录 (Blackboard Pattern)       │
│  │ TodoStore          │  任务计划                              │
│  └────────────────────┘                                        │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   LLM 层 (src/llm/)                             │
│                     LLMClient                                   │
│           chatStream() / chat()                                 │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   工具层 (src/tools/)                           │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐       │
│  │ read-file│ │write-file│ │ edit-file│ │ spawn-agents │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────┘       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐       │
│  │   bash   │ │   memo   │ │   todo   │ │  glob/grep   │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────┘       │
└─────────────────────────────────────────────────────────────────┘
```

## 核心组件

### 1. CLI 入口

**文件**: `src/cli/index.ts`

负责解析命令行参数、加载配置、选择运行模式。

```typescript
// 三种运行模式
if (prompt) {
  await runOnce(prompt, config);        // 单次执行
} else if (opts.simple) {
  await startRepl({ config });          // 简单 REPL
} else {
  await startTui({ config });           // 全屏 TUI (默认)
}
```

### 2. Agent 层

#### 单 Agent 模式

**文件**: `src/core/agent.ts`

适用于简单任务，一个 Agent 完成所有工作。具备完整的工具权限和安全检查。

```
用户输入 → LLM → 工具调用 → ReadTracker 检查 → 执行 → 结果 → LLM → ...
```

```typescript
class Agent {
  async run(prompt: string, callbacks: AgentCallbacks) {
    // 每轮循环:
    // 1. LLM 调用 (chatStream)
    // 2. 工具调用执行
    // 3. ReadTracker: 先读后改 / 覆盖检查
    // 4. Auto-memo 记录
    // 5. 返回结果给 LLM
  }
}
```

**安全特性**:
- **先读后改**: `edit-file` 前必须 `read-file` 了解当前内容
- **覆盖保护**: `write-file` 已存在文件需要 `overwrite: true`
- **Memo 集成**: 自动记录文件读写，AI 可手动写摘要

#### 双 Agent 模式

**文件**: `src/core/dual-agent/orchestrator.ts`, `src/core/dual-agent/coder.ts`

调度者（Orchestrator）+ 编码者（Coder），通过 memo 共享上下文。

```
Orchestrator                    Coder
    │                              │
    ├── glob/read-file 收集      │
    ├── memo write plan:xxx      │  (记录架构分析)
    │                              │
    ├── send-to-coder ──────────►│
    │   task + context             │
    │                              ├── memo read (获取上下文)
    │                              ├── write-file/edit-file
    │                              ├── memo write (记录改动摘要)
    │                              │   用户可见的摘要
    ◄─────────────────────────────┤  一句话报告
```

##### Orchestrator 5 步工作流

```markdown
### Orchestrator 系统提示词

你是侦察兵 + 指挥官。你自己不写代码，只负责收集信息、分析、委派。

1. **评估任务复杂度**
   简单任务(1-3文件)直接回复建议；复杂任务进入下一步

2. **收集上下文**
   glob 找文件 → read-file 读内容

3. **记录分析结论** (⭐ 关键步骤)
   委派前用 memo write 记录：
   - 跨文件依赖关系
   - 命名约定
   - 架构决策
   key 建议用 plan:xxx 格式

4. **逐步委派编码**: send-to-coder
   任务描述格式：
   [目标] 做什么（一句话）
   [文件] 目标文件路径
   [要求] 命名、格式、接口约束
   [参考] memo 中相关 key

5. **迭代或验证**
   Coder 返回后验证：检查是否满足要求，如需调整再次 send-to-coder
```

##### Coder 4 步工作流

```markdown
### Coder 身份

你是编码 Agent，收到任务后立即动手，不探索、不分析。

**核心原则**: ⭐ 不确定任何细节时，先 `memo read` 看详情再动手

### 第一步：理解上下文
- 阅读 task 中的 [参考] 部分提到的 memo key
- 需要引用其他文件时，先 `memo read file:路径`

### 第二步：编码
- 新建文件 → `write-file`
- 修改文件 → `read-file` 获取内容 → `edit-file`

❌ 禁止：凭记忆猜测函数名或文件内容 — 用 `memo read` 确认

### 第三步：写摘要
编码完成后，用 `memo write` 为每个创建/修改的文件写一条摘要：
  `memo write file:路径 "摘要内容"`

摘要应包含：文件用途、关键导出（函数名、类名等）、其他 agent 需要知道的信息。

示例：`memo write file:demo/utils.js "工具函数模块，导出 formatDate(date)、animateHorse(elementId)"`

### 第四步：回复
一句话报告结果："完成了 X，创建了 Y 文件，Z 函数已可用"
```

##### 协作模式

| 模式 | Coder 工具 | 说明 |
|------|-----------|------|
| `delegated` | 有 | 调度者委派，Coder 独立执行（默认） |
| `autonomous` | 有 | Coder 自主决策 |
| `controlled` | 无 | Coder 只返回代码，Orchestrator 执行 |

### 3. 安全与追踪层

#### ReadTracker

**文件**: `src/core/read-tracker.ts`

强制先读后改、防止意外覆盖的安全机制。

```typescript
class ReadTracker {
  markRead(path: string): void           // 记录已读文件
  markWritten(path: string): void        // 记录已写文件
  hasRead(path: string): boolean         // 检查是否已读
  checkWriteOverwrite(path: string, overwrite?: boolean): string | null
                                         // 检查覆盖风险，返回警告或 null
}
```

**执行流程**:
1. Agent/SubAgent 收到 `edit-file` → 检查 `hasRead()`
2. 未读取 → 拒绝执行，提示先 `read-file`
3. 收到 `write-file` → 检查 `checkWriteOverwrite()`
4. 文件已存在且未指定 `overwrite: true` → 拒绝执行

#### Auto-memo

**文件**: `src/core/auto-memo.ts`

自动记录文件操作，为 Agent 提供上下文回溯能力。

```typescript
// 自动记录的内容（仅存储，不提取符号）
write-file → memo [file:path] = { content, summary: "新建 N行", author: "auto" }
edit-file  → memo [file:path] = { content: 变更diff, summary: "编辑 N行变更", author: "auto" }
read-file  → memo [file:path] = { content, summary: "已读 N行", author: "auto" }
```

**AI 写摘要**: 编码完成后，Agent 使用 `memo write file:路径 "摘要"` 写入人工可读的摘要，这些摘要会在 TUI 中显示给用户。

### 4. 工具层

#### 工具注册表

**文件**: `src/tools/registry.ts`

管理所有可用工具及其权限级别。

```typescript
class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private permissions: Map<string, PermissionLevel> = new Map();

  register(tool: Tool) { ... }
  unregister(name: string) { ... }
  execute(name: string, params: Record<string, unknown>): Promise<ToolResult> { ... }
  toToolDefinitions(filter?: string[]): ToolDefinition[] { ... }
}
```

#### 权限级别

```typescript
type PermissionLevel = 'auto' | 'confirm' | 'deny';
```

- `auto` — 自动执行（如 read-file、glob、memo）
- `confirm` — 需要用户确认（如 write-file、bash）
- `deny` — 禁止执行

#### 内置工具

| 工具 | 功能 | 权限 | 特殊说明 |
|------|------|------|----------|
| `read-file` | 读取文件 | auto | 触发 ReadTracker.markRead |
| `write-file` | 创建/覆盖文件 | confirm | overwrite 参数防止意外覆盖 |
| `edit-file` | 编辑文件 | confirm | 要求先 read-file |
| `glob` | 文件搜索 | auto | 支持 glob 模式 |
| `grep` | 代码搜索 | auto | 正则搜索 |
| `bash` | 执行命令 | confirm | Windows 自动使用 cmd.exe |
| `memo` | 共享备忘录 | auto | write 的摘要用户可见 |
| `todo` | 任务计划 | auto | 多步骤任务管理 |
| `spawn-agents` | 并行子 Agent | confirm | 并行执行子任务 |

#### 跨平台适配

**Bash 工具** (`src/tools/bash.ts`):
- Windows 环境 → 使用 `cmd.exe /c`
- Unix 环境 → 使用 `/bin/bash -c`
- 自动检测，Agent 无感知

### 5. TUI 层

**文件**: `src/cli/tui/`

基于 Ink + React 的全屏终端界面。

#### 架构

```
┌─────────────────────────────────────────────────────┐
│                    App.tsx                           │
│  ┌───────────────────────────────────────────────┐  │
│  │              ChatArea.tsx                     │  │
│  │   Static (已完成内容)  │  Dynamic (流式内容)  │  │
│  └───────────────────────────────────────────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌────────────────┐       │
│  │ InputArea│ │StatusBar │ │ ConfirmPrompt  │       │
│  └──────────┘ └──────────┘ └────────────────┘       │
└─────────────────────────────────────────────────────┘
           │                │
           ▼                ▼
┌─────────────────────────────────────────────────────┐
│                    bridge.ts                         │
│    createBridgeCallbacks(dispatch) → TuiAction       │
└─────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────┐
│                    state.ts                          │
│              tuiReducer(state, action)               │
└─────────────────────────────────────────────────────┘
```

#### Memo 摘要显示

**ToolCallLine.tsx** 显示 memo write 的摘要内容：

```
memo write file:utils.js "工具函数，导出 formatDate、animateHorse"
           ↑
    用户可见的 AI 摘要
```

#### 渲染策略

采用 **Log-Style** 渲染，面向 Windows 终端兼容性：

1. **Static 区域** — 已完成的内容，推入 Ink `<Static>` 后写入 scrollback，永不重绘
2. **Dynamic 区域** — 最小重绘面积（最多 1 行），用于流式输出

#### Windows 终端兼容性

- 移除 `<Spinner>` 动画（定时器重绘导致残影）
- 移除边框组件（borderStyle 会产生 3 行残影）
- 实时进度用 Dynamic 区域（Static 在 Windows 上不实时刷新）
- 使用 `seenIds` + `accumulated` ref 防止 Static 重复渲染

### 6. LLM 层

**文件**: `src/llm/client.ts`

OpenAI 兼容 API 客户端，支持流式和非流式调用。

```typescript
class LLMClient {
  async chatStream(
    messages: Message[],
    tools: ToolDefinition[] | undefined,
    callbacks: StreamCallbacks
  ): Promise<Message> { ... }

  async chat(
    messages: Message[],
    tools?: ToolDefinition[]
  ): Promise<Message> { ... }
}
```

### 7. 配置系统

**文件**: `src/config/loader.ts`, `src/config/types.ts`

支持多种配置方式（优先级从高到低）：

1. CLI 参数 (`--api-key`, `--model`, `--base-url`)
2. 环境变量 (`ZENCODE_API_KEY`)
3. 配置文件 (`.zencode/config.yaml` 或 `~/.zencode/config.yaml`)

```typescript
interface ZenCodeConfig {
  // 模型配置
  model: string;
  api_key: string;
  base_url: string;
  temperature: number;
  max_tokens: number;

  // Agent 模式
  agent_mode: 'single' | 'dual';
  collaboration: 'delegated' | 'autonomous' | 'controlled';

  // 双 Agent 独立配置（可选）
  dual_agent: {
    orchestrator?: Partial<ModelConfig>;
    coder?: Partial<ModelConfig>;
  };

  // 功能开关
  features: {
    git: 'auto' | 'on' | 'off';
    mcp: 'on' | 'off';
    planning_layer: 'on' | 'off';
    parallel_agents: 'on' | 'off';
    todo: 'on' | 'off';
  };

  // 权限
  permissions: PermissionsConfig;

  // MCP 服务器
  mcp_servers: McpServerConfig[];

  // 自定义提示词
  prompts: string[];

  // 工具输出限制
  max_tool_output: number;
}
```

## 数据流

### 1. 用户输入 → LLM

```
用户输入
    │
    ▼
App.tsx: handleSubmit()
    │
    ├── /slash 命令处理
    │       ├── /clear → 重建 Agent + 清空 memo
    │       ├── /single, /dual → 切换模式
    │       └── ...
    │
    ▼
Agent.run() / Orchestrator.run()
    │
    ▼
LLMClient.chatStream()
    │
    ▼
StreamCallbacks.onContent() → TUI 显示
```

### 2. LLM 工具调用

```
LLM 返回 tool_calls
    │
    ├── onToolCallStreaming() ──→ TUI: 工具参数流式更新
    │
    ▼
检查权限 (registry.getPermissionLevel())
    │
    ├── auto → 直接执行
    ├── confirm → 等待用户确认
    └── deny → 拒绝
    │
    ▼
registry.execute()
    │
    ├── ReadTracker 检查
    │   ├── edit-file → 检查 hasRead()
    │   └── write-file → 检查 overwrite
    │
    ▼
autoMemoForTool() → 记录到 MemoStore
    │
    ▼
onToolResult() ──→ TUI: 工具结果
```

### 3. 双 Agent 协作

```
Orchestrator LLM
    │
    ├── memo write plan:xxx (架构分析)
    │
    ├── send-to-coder(task, context)
    │   │ 注入：
    │   │ - task + context
    │   │ - [共享备忘录] index
    │   │ - "立即编码，不探索"
    │   │
    ▼   ▼
  invokeCoder()
    │
    ▼
Coder LLM
    │
    ├── memo read (获取上下文)
    ├── write-file / edit-file
    ├── memo write file:xxx (用户可见的摘要)
    │
    ▼
返回结果给 Orchestrator
```

## 关键设计决策

### 1. 为什么用双 Agent？

**问题**: 单 Agent 既要收集上下文，又要写代码，容易「既要又要」，效率低下。

**解决**: 分离关注点
- **Orchestrator**: 侦察兵 + 指挥官，不写代码，只负责收集信息和委派
- **Coder**: 执行者，收到的任务已包含所有上下文，直接动手

### 2. 为什么用 memo 作为协作桥梁？

**问题**: Orchestrator 收集的上下文无法传递给 Coder，导致 Coder 重复探索。

**解决**: memo 是共享记忆 (Blackboard Pattern)
- Orchestrator 收集 → `memo write plan:xxx`
- Coder 编码前 → `memo read`
- Coder 完成 → `memo write file:xxx` 记录改动（用户可见）

### 3. 为什么 AI 写摘要而不是自动提取？

**问题**: 自动提取符号（函数名、类名）需要语言特定的解析器，无法通用。

**解决**: AI 编码后写摘要
- 更灵活：AI 知道哪些信息对其他 Agent 重要
- 更准确：能描述功能，不只是罗列名称
- 用户可见：在 TUI 中显示，增加透明度

### 4. 为什么用 TUI 而非纯文本？

**问题**: 纯文本模式难以表达复杂信息（工具调用、确认、进度）。

**解决**: 全屏 TUI
- 流式输出，自然分段
- 工具调用可视化
- 用户确认交互
- 实时进度显示

### 5. 为什么 Log-Style 渲染？

**问题**: Ink 的动态重绘机制在 Windows 终端上产生残影（ANSI 清除不生效）。

**解决**: 只增不减的 Static
- 已完成内容全部推入 `<Static>`，永不重绘
- Dynamic 区域最小化（1 行）
- 特殊处理：实时进度用 Dynamic

### 6. 为什么强制先读后改？

**问题**: AI 可能基于记忆中的过时内容编辑文件，导致代码损坏。

**解决**: ReadTracker 强制执行
- `edit-file` 前必须 `read-file`
- `write-file` 覆盖需要显式 `overwrite: true`
- Agent、SubAgent、Coder 都受此限制

## 扩展开发

### 添加新工具

1. 在 `src/tools/` 目录创建工具文件
2. 实现 `Tool` 接口
3. 在 `src/tools/register.ts` 注册

```typescript
// src/tools/my-tool.ts
export const myTool: Tool = {
  name: 'my-tool',
  description: '我的工具描述',
  parameters: {
    type: 'object',
    properties: {
      input: { type: 'string' }
    },
    required: ['input']
  },
  permissionLevel: 'confirm',
  async execute(params) {
    // 实现逻辑
    return { content: '结果' };
  }
};
```

### 添加新模型

修改 `src/llm/client.ts`，确保兼容 OpenAI API 格式：

```typescript
// 只需 base_url 指向兼容端点
const client = new OpenAI({
  apiKey: 'your-key',
  baseURL: 'https://your-model-api.com/v1'
});
```

### 添加新功能

1. 在对应模块添加逻辑
2. 如需 TUI 支持，在 `src/cli/tui/state.ts` 添加 action
3. 在对应组件处理渲染

## 文件结构

```
zencode/
├── bin/
│   └── zencode.ts          # CLI 入口
├── src/
│   ├── cli/
│   │   ├── index.ts        # CLI 主程序
│   │   ├── repl.ts         # 简单 REPL
│   │   ├── ui.ts           # 非 TUI 输出
│   │   └── tui/
│   │       ├── index.tsx   # TUI 入口
│   │       ├── App.tsx     # 主组件
│   │       ├── state.ts    # 状态管理
│   │       ├── bridge.ts   # 回调桥接
│   │       └── components/ # UI 组件
│   │           ├── ChatArea.tsx
│   │           ├── InputArea.tsx
│   │           ├── StatusBar.tsx
│   │           ├── ToolCallLine.tsx  # 工具调用显示（含 memo 摘要）
│   │           └── ...
│   ├── config/
│   │   ├── loader.ts       # 配置加载
│   │   ├── types.ts        # 类型定义
│   │   └── defaults.ts     # 默认配置
│   ├── core/
│   │   ├── agent.ts        # 单 Agent
│   │   ├── conversation.ts # 对话管理
│   │   ├── todo-store.ts   # Todo 存储
│   │   ├── memo-store.ts   # Memo 存储（Blackboard）
│   │   ├── read-tracker.ts # 先读后改 / 覆盖保护
│   │   ├── auto-memo.ts    # 自动记录文件操作
│   │   ├── sub-agent.ts    # 子 Agent（并行）
│   │   ├── sub-agent-tracker.ts
│   │   └── dual-agent/
│   │       ├── orchestrator.ts   # 调度者
│   │       ├── coder.ts          # 编码者
│   │       └── modes.ts          # 协作模式定义
│   ├── llm/
│   │   ├── client.ts       # LLM 客户端
│   │   └── types.ts        # 类型定义
│   ├── tools/
│   │   ├── registry.ts     # 工具注册表
│   │   ├── permission.ts   # 权限检查
│   │   ├── register.ts     # 内置工具注册
│   │   ├── types.ts        # 工具类型
│   │   ├── read-file.ts
│   │   ├── write-file.ts
│   │   ├── edit-file.ts
│   │   ├── bash.ts         # 跨平台命令执行
│   │   ├── glob.ts
│   │   ├── grep.ts
│   │   ├── memo.ts
│   │   ├── todo.ts
│   │   ├── git.ts
│   │   └── spawn-agents.ts
│   ├── mcp/
│   │   ├── client.ts       # MCP 客户端
│   │   └── bridge.ts       # MCP 工具桥接
│   └── prompt/
│       ├── builder.ts      # 提示词构建
│       └── layers/         # 提示词分层
│           ├── core.ts
│           ├── planning.ts
│           ├── parallel.ts
│           ├── git.ts
│           └── project.ts
├── dist/                   # 构建输出
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── README.md
└── DESIGN.md
```
