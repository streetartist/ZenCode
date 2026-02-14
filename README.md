# ZenCode

极简 CLI AI 编程工具 — 用最少的提示词，让模型把全部能力集中在编程本身。

## 特性

- **双 Agent 协作** — 调度者（Orchestrator）收集上下文、拆分任务，编码者（Coder）专注编程
- **Memo 共享记忆** — Agent 之间通过备忘录传递上下文，AI 自主撰写文件摘要
- **先读后改** — 系统级强制：未读取的文件无法编辑，杜绝盲改
- **覆盖保护** — write-file 已存在的文件必须显式确认，防止误覆盖
- **跨平台** — 自动识别 Windows/Linux/macOS，命令提示适配当前平台
- **并行子 Agent** — spawn-agents 并行处理多文件任务
- **全屏 TUI** — 交互式终端界面，流式输出、工具确认、实时进度

## 安装

```bash
npm install -g zencode-cli
```

## 快速开始

```bash
# 交互式 TUI 模式（推荐）
zencode

# 单次执行
zencode "帮我写一个 Hello World"

# 查看帮助
zencode --help
```

## 配置

### 配置文件

`~/.zencode/config.yaml`（Linux/Mac）或 `%USERPROFILE%\.zencode\config.yaml`（Windows）：

```yaml
# 模型配置
model: deepseek-chat
api_key: sk-xxx
base_url: https://api.deepseek.com/v1

# Agent 模式
agent_mode: dual            # single | dual
collaboration: delegated     # delegated | autonomous | controlled

# 双 Agent 分别配置模型（可选）
orchestrator:
  model: deepseek-chat       # 调度者使用的模型
coder:
  model: deepseek-coder      # 编码者使用的模型

# 功能开关
features:
  parallel_agents: on        # on | off
  todo: on                   # on | off

# 高级选项
max_tokens: 8192
temperature: 0.7
max_tool_output: 4000

# 权限配置（可选）
permissions:
  bash: confirm              # auto | confirm | deny
  write-file: confirm
  read-file: auto
```

### 环境变量

| 变量 | 说明 |
|------|------|
| `ZENCODE_API_KEY` | API 密钥（优先级高于配置文件） |
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
  --single             使用单 Agent 模式
  --dual               使用双 Agent 模式
  --mode <mode>        协作模式 (delegated/autonomous/controlled)
  --simple             使用简单 REPL 模式（非全屏 TUI）
  -h, --help           显示帮助
```

## Agent 模式

### 单 Agent 模式（`--single`）

一个 Agent 完成所有工作：理解需求 → 收集上下文 → 写代码 → 执行验证。

### 双 Agent 模式（默认）

```
用户请求
    ↓
Orchestrator（调度者）
    ├── 1. 评估任务，决定拆分策略
    ├── 2. glob/read-file 收集上下文
    ├── 3. memo write 记录分析结论（架构、依赖、命名约定）
    ├── 4. send-to-coder 逐步委派原子任务
    │       ↓
    │   Coder（编码者）
    │       ├── memo read 查看已有文件详情
    │       ├── write-file / read-file + edit-file
    │       ├── memo write 为每个文件写摘要（函数名、用途）
    │       └── 返回结果
    ├── 5. 检查 memo 确认结果，继续下一步或修复
    └── 6. 汇报用户
```

#### 任务拆分

调度者按依赖顺序拆分多文件任务：
- 基础模块/工具函数 → 先做
- 依赖基础模块的页面/组件 → 后做
- 每次 send-to-coder 只发一个原子任务（1-3 个文件）

#### 协作模式

| 模式 | 说明 | Coder 工具 | 适用场景 |
|------|------|-----------|----------|
| `delegated` | 调度者委派，Coder 独立执行 | 全部 | 大多数场景 |
| `autonomous` | Coder 自主决策 | 全部 | 能力强的模型 |
| `controlled` | Coder 只返回代码，调度者执行文件操作 | 无 | 需要严格控制 |

```bash
zencode --mode delegated
zencode --mode autonomous
zencode --mode controlled
```

TUI 中切换：`/mode delegated`

## Memo 共享记忆

双 Agent 协作的核心。所有文件操作自动存储内容到 memo，AI 自主撰写有意义的摘要。

### 自动存储

文件操作（read-file、write-file、edit-file）成功后，完整内容自动存入 memo：
- key 格式：`file:路径`（如 `file:demo/utils.js`）
- 其他 Agent 可通过 `memo read file:路径` 查看完整文件内容

### AI 撰写摘要

Coder 编码完成后，用 memo write 为每个文件写一条摘要：
```
memo write file:demo/utils.js "工具函数模块，导出 formatDate(date)、animateHorse(elementId)"
```

摘要对用户可见，显示为：
```
✓ 📝 memo write [file:demo/utils.js] memo [file:demo/utils.js]: 工具函数模块，导出 formatDate(date)...
```

### 调度者分析结论

Orchestrator 委派前记录架构决策：
```
memo write plan:architecture "Flask + Jinja2 模板，静态文件在 demo/static/"
```

### Coder 看到的备忘录

send-to-coder 时自动注入 memo 索引到任务末尾：
```
[调度者补充上下文]
utils.js 导出了 formatDate(date)，main.js 需要 import 引用

[共享备忘录]
[file:demo/utils.js] 工具函数模块，导出 formatDate(date)、animateHorse(elementId)
[file:demo/templates/index.html] 已读 80行
[plan:architecture] Flask + Jinja2 模板，静态文件在 demo/static/
```

Coder 可 `memo read file:demo/utils.js` 查看完整文件内容。

## 安全机制

### 先读后改（ReadTracker）

系统级强制：每个 Agent 会话中维护已读文件集合。

- `read-file` 成功 → 标记已读
- `write-file` 成功 → 标记已读（刚写的文件 agent 已知内容）
- `edit-file` 调用前 → 检查是否已读，未读则拒绝：
  ```
  ⚠ 禁止编辑未读取的文件。请先 read-file "demo/app.py" 了解当前内容，再 edit-file。
  ```

### 覆盖保护

write-file 目标文件已存在时，要求 AI 二次确认：
```
⚠ 文件已存在：demo/app.py
修改已有文件请用 read-file + edit-file（更精确安全）。
如确需完整重写，请重新调用 write-file 并设置 overwrite: true。
```

### 权限系统

| 工具 | 默认权限 | 说明 |
|------|---------|------|
| `read-file` | auto | 自动执行 |
| `write-file` | confirm | 需用户确认 |
| `edit-file` | confirm | 需用户确认 |
| `bash` | confirm | 需用户确认 |
| `glob` | auto | 自动执行 |
| `grep` | auto | 自动执行 |
| `memo` | auto | 自动执行 |
| `todo` | auto | 自动执行 |
| `spawn-agents` | auto | 自动执行 |

权限级别：`auto`（自动执行）、`confirm`（需确认）、`deny`（禁止）

## 功能

### 并行子 Agent

用 spawn-agents 并行处理多个独立任务：
- 并行读取多个文件
- 并行搜索代码
- 多文件批量分析

TUI 中切换：`/parallel`

### Todo 计划

内置任务清单，跟踪多步骤项目。

TUI 中切换：`/todo`

### 跨平台

bash 工具自动适配当前平台：
- **Windows** → 使用 cmd.exe，提示词引导使用 Windows 命令或 Python 跨平台命令
- **Linux/macOS** → 使用 /bin/bash

## TUI 命令

| 命令 | 说明 |
|------|------|
| `/help` | 显示帮助 |
| `/mode [模式]` | 切换协作模式 |
| `/single` | 切换到单 Agent |
| `/dual` | 切换到双 Agent |
| `/parallel` | 开关并行子 Agent |
| `/todo` | 开关 Todo 计划 |
| `/clear` | 清空对话历史 |
| `/info` | 显示当前配置 |

## 快捷键

| 快捷键 | 说明 |
|--------|------|
| `Ctrl+C` | 取消当前请求 / 退出 |
| `Ctrl+D` | 退出程序 |
| `Enter` | 发送消息 |

## 支持的模型

通过 OpenAI 兼容 API 连接各种模型：

```yaml
# DeepSeek
model: deepseek-chat
base_url: https://api.deepseek.com/v1

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
