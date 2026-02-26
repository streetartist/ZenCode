# ZenCode

极简 CLI AI 编程工具 — 用最少的提示词，让模型把全部能力集中在编程本身。

## 特性

- **单 Agent 循环** — 理解需求 → 收集上下文 → 写代码 → 执行验证，一个 Agent 完成所有工作
- **先读后改** — 系统级强制：未读取的文件无法编辑，杜绝盲改
- **覆盖保护** — write-file 已存在的文件必须显式确认，防止误覆盖
- **并行子 Agent** — spawn-agents 并行处理多文件任务
- **可配置子 Agent** — dispatch 工具支持 YAML 定义的专用子 Agent
- **自定义技能** — 用户可定义斜杠命令，展开为完整提示词
- **全屏 TUI** — 交互式终端界面，流式输出、工具确认、实时进度
- **跨平台** — 自动识别 Windows/Linux/macOS，命令提示适配当前平台
- **deepseek-reasoner 兼容** — 支持 reasoning_content 思维链显示

## 安装

```bash
npm install -g zencode-cli
```

## 快速开始

```bash
# 交互式 TUI 模式（推荐）
zencode

# 简单 REPL 模式
zencode --simple

# 单次执行
zencode "帮我写一个 Hello World"

# 查看帮助
zencode --help
```

## 配置

### 配置文件

`~/.zencode/config.yaml`（全局）或项目目录下 `.zencode/config.yaml`（项目级）：

```yaml
# 模型配置
model: deepseek-chat
api_key: sk-xxx
base_url: https://api.deepseek.com/v1
temperature: 0.7
max_tokens: 8192

# 功能开关
features:
  git: auto                  # auto | on | off
  mcp: off                   # on | off（暂未实现）
  planning_layer: on         # on | off
  parallel_agents: on        # on | off
  todo: on                   # on | off

# 权限配置
permissions:
  auto_approve:              # 自动执行的工具
    - read-file
    - glob
    - grep
    - spawn-agents
    - todo
    - dispatch
  require_approval:          # 需用户确认的工具
    - write-file
    - edit-file
    - bash
    - git

# 自定义提示词
prompts:
  - "始终使用中文回答"

# 工具输出最大长度
max_tool_output: 30000
```

配置优先级（从低到高）：默认值 < 全局 `~/.zencode/config.yaml` < 项目 `.zencode/config.yaml` < 项目根 `.zencode.yaml` < 环境变量 < CLI 参数

### 环境变量

| 变量 | 说明 |
|------|------|
| `ZENCODE_API_KEY` | API 密钥 |
| `ZENCODE_BASE_URL` | API 地址 |
| `ZENCODE_MODEL` | 模型名称 |

### CLI 参数

```
zencode [options] [prompt...]

Arguments:
  prompt                直接执行的提示词（非交互式）

Options:
  -V, --version        显示版本号
  -m, --model <model>  指定模型名称
  -k, --api-key <key>  API 密钥
  -u, --base-url <url> API 基础 URL
  --simple             使用简单 REPL 模式（非全屏 TUI）
  -h, --help           显示帮助
```

## 工具

| 工具 | 默认权限 | 说明 |
|------|---------|------|
| `read-file` | auto | 读取文件 |
| `write-file` | confirm | 写入文件 |
| `edit-file` | confirm | 编辑文件 |
| `bash` | confirm | 执行命令 |
| `glob` | auto | 文件搜索 |
| `grep` | auto | 内容搜索 |
| `spawn-agents` | auto | 并行子 Agent |
| `dispatch` | auto | 分派子 Agent |
| `todo` | auto | 任务计划 |

权限级别：`auto`（自动执行）、`confirm`（需确认）、`deny`（禁止）

## 安全机制

### 先读后改（ReadTracker）

系统级强制：每个 Agent 会话中维护已读文件集合。

- `read-file` 成功 → 标记已读
- `write-file` 成功 → 标记已读（刚写的文件 Agent 已知内容）
- `edit-file` 调用前 → 检查是否已读，未读则拒绝

### 覆盖保护

write-file 目标文件已存在时，要求设置 `overwrite: true` 才能覆盖。

## TUI 命令

| 命令 | 说明 |
|------|------|
| `/help` | 显示帮助 |
| `/skills` | 列出所有可用技能 |
| `/agents` | 列出所有可用子 Agent |
| `/parallel` | 切换并行子 Agent on/off |
| `/todo` | 切换 Todo 计划 on/off |
| `/clear` | 清空对话历史 |
| `/info` | 显示当前配置 |

## 快捷键

| 快捷键 | 说明 |
|--------|------|
| `Ctrl+C` / `Escape` | 取消当前请求 |
| `Ctrl+D` | 退出程序 |
| `Enter` | 发送消息 |

## 扩展

### 自定义子 Agent

在 `~/.zencode/agents/` 或 `.zencode/agents/` 放置 YAML 文件：

```yaml
name: reviewer
description: 代码审查专家
system_prompt: 你是代码审查专家，专注于发现潜在问题。
tools:
  - read-file
  - glob
  - grep
```

使用时 Agent 会通过 `dispatch` 工具自动调度。

### 自定义技能

在 `~/.zencode/skills/` 或 `.zencode/skills/` 放置 YAML 文件：

```yaml
name: review
description: 审查当前项目代码
prompt: |
  请审查当前项目的代码质量，重点关注：
  1. 潜在 bug
  2. 安全问题
  3. 代码规范
```

然后在 TUI 中输入 `/review` 即可触发。

## 支持的模型

通过 OpenAI 兼容 API 连接各种模型：

```yaml
# DeepSeek
model: deepseek-chat
base_url: https://api.deepseek.com/v1

# DeepSeek Reasoner（支持思维链）
model: deepseek-reasoner
base_url: https://api.deepseek.com

# 阿里 Qwen
model: qwen-turbo
base_url: https://dashscope.aliyuncs.com/compatible-mode/v1

# OpenAI
model: gpt-4o
base_url: https://api.openai.com/v1
```

## 开发

```bash
git clone https://github.com/your-repo/zencode.git
cd zencode
npm install
npm run dev     # 开发模式
npm run build   # 构建
npm link        # 链接本地
```

## 许可证

MIT
