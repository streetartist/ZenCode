# ZenCode：双Agent编程助手

## 核心理念：各司其职，不要"既要又要"

ZenCode 的设计哲学很简单：

> **侦察兵负责侦察，编码兵负责编码。**

想象一个真实的开发团队：
- 产品经理/架构师会先调研需求、梳理现有代码、制定方案
- 然后他们把任务清晰地分配给开发工程师
- 工程师拿到任务后直接动手，不需要再花半小时理解业务

但现有的 AI 工具让一个 Agent 干所有事：
- 既要收集上下文（侦察）
- 又要写代码（编码）
- 还要记住刚才改了什么（记忆）

结果它经常在"侦察"和"编码"之间反复横跳，效率低下。

## ZenCode 的双 Agent 架构

我们把一个 AI 拆成两个角色：

### 1. Orchestrator（调度者）—— 侦察兵 + 指挥官

**它的职责：**
- 评估任务复杂度
- 用 `glob` 找文件、`read-file` 读代码
- **关键：把收集到的信息写入共享备忘录（memo）**
- 把任务清晰地委派给 Coder

**它不干的事：**
- 不写代码
- 不直接修改文件

### 2. Coder（编码者）—— 执行者

**它的职责：**
- 收到任务后直接动手
- 用 `write-file` 或 `edit-file` 写代码
- 写完后用 `memo write` 记录改了什么
- 一句话汇报结果

**它的特点：**
- 不做探索
- 不分析需求
- 拿到任务就编码

```
用户：给登录页面加个验证码

Orchestrator:
  ├── 读取 src/pages/login.tsx
  ├── 读取 src/components/ 目录
  ├── memo write plan:login  "登录页使用 Form 组件，需要
  │    在密码框下方插入验证码输入框"
  └── send-to-coder:
      "在 login.tsx 的密码框下方添加验证码输入框，
       参考 memo key 'plan:login'"

Coder:
  ├── memo read plan:login
  ├── edit-file login.tsx （添加验证码）
  ├── memo write file:login.tsx "已添加验证码组件"
  └── 报告：完成
```

整个流程**没有重复的探索**，因为 Orchestrator 已经把路探好了。

## Memo：两个 AI 之间的"传纸条"

Orchestrator 和 Coder 怎么共享信息？通过 `memo` 工具。

**用法很简单：**
```bash
memo write plan:architecture "项目使用 React + TypeScript，组件放在 src/components/"
memo read plan:architecture
memo write file:utils.ts "工具函数，导出 formatDate、validateEmail"
```

**为什么不用对话历史？**

因为对话历史会越积越多，最终占满上下文窗口。memo 是**按需读取**的：
- Coder 只在需要时 `memo read` 特定的 key
- 不相关的信息不会占用它的上下文

**AI 自己写摘要：**

和其他工具自动提取代码符号不同，ZenCode 让 AI **自己写摘要**。比如：

```
memo write file:utils.js "工具函数模块，导出：
- formatDate(date) - 格式化日期为 YYYY-MM-DD
- animateHorse(elementId) - 马年动画效果
- playSound(url) - 播放音效"
```

这样做的好处：
1. **跨语言通用**——不需要为 Python、Java、Go 写不同的解析器
2. **AI 知道什么重要**——它能描述功能，而不是罗列函数名
3. **用户可见**——你在 TUI 里能看到 AI 写了什么摘要

## 安全机制：先读后改，防止"瞎改"

AI 编程最可怕的事情：**基于记忆修改文件**。

想象这个场景：
1. 你让 AI 看了一个文件
2. 过了一会儿，你又让它修改这个文件
3. 它凭着记忆里的内容去改，但文件已经被你手动改过了
4. **结果：代码被覆盖，功能损坏**

ZenCode 用 `ReadTracker` 强制规定：

> **想 edit-file？先 prove 你 read-file 过。**

如果没读就尝试编辑，工具会直接拒绝：
```
⚠ 禁止编辑未读取的文件。请先 read-file "src/App.tsx" 了解当前内容，再 edit-file。
```

同样，覆盖已存在的文件需要显式声明：
```
write-file 发现 src/config.ts 已存在。
如确实要覆盖，请添加参数 overwrite: true
```

这防止了大部分"手滑"事故。

## 总结：让 AI 做 AI 擅长的事

ZenCode 不是要做功能最多的 AI 编程工具，而是要做**最专注**的：

- **Orchestrator 专注**——信息收集和任务拆分
- **Coder 专注**——编码执行
- **用户专注**——描述需求，而不是纠正 AI 的错误

如果你也厌倦了和 AI"反复拉扯"，可以试试 ZenCode。

---

**GitHub:** https://github.com/streetartist/zencode
**License:** MIT
