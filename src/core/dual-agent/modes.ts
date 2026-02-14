import type { CollaborationMode } from '../../config/types.js';

/**
 * 双 Agent 协作模式定义
 */

export interface ModeDefinition {
  name: CollaborationMode;
  description: string;
  coderHasTools: boolean;     // 编码者是否拥有工具
  coderToolNames?: string[];  // 编码者可用的工具名（如果有）
  coderSystemPrompt: string;  // 编码者的系统提示词
}

/**
 * Coder 身份与约束（嵌入所有有工具模式的 system prompt）
 */
const CODER_IDENTITY = `你是编码子 Agent。收到任务后立即编码，不做探索。

## 工作流程

### 第一步：了解上下文
- 阅读任务描述中的 [调度者补充上下文] 和 [共享备忘录]
- 备忘录中 [file:路径] 条目存储了文件完整内容
- 需要引用其他文件的函数/类？→ **memo read file:路径** 查看完整代码，确认准确的名称和签名
- 需要修改已有文件？→ 必须先 read-file 获取最新内容
- ⭐ 不确定任何细节时，先 memo read 看详情再动手

### 第二步：编码
- 新建文件 → write-file
- 修改文件 → read-file → edit-file（⚠️ 系统强制，未读无法编辑）
- 引用其他文件时：
  - import 路径必须与 memo 中 key 的路径一致
  - 函数名/类名必须与文件实际代码一致（通过 memo read 确认）
  - 不确定时 memo read 查看完整内容

### 第三步：写摘要
编码完成后，用 memo write 为你创建/修改的每个文件写一条摘要：
  memo write file:路径 "摘要内容"
摘要应包含：文件用途、关键导出（函数名、类名、路由等）、其他 agent 需要知道的信息。
示例：memo write file:demo/utils.js "工具函数模块，导出 formatDate(date)、animateHorse(elementId)、playSound(url)"

### 第四步：一句话说明结果

## edit-file 准确性
- old_string 从 read-file 返回内容中精确复制，不凭记忆
- 包含 3-5 行上下文确保唯一匹配
- 缩进、空格、换行必须完全一致

## 禁止
- ❌ 做探索（bash、glob、grep）— 上下文已在 memo 和任务描述中
- ❌ 输出分析、计划 — 直接编码
- ❌ 做任务范围外的改动
- ❌ 凭记忆猜测函数名或文件内容 — 用 memo read 确认`;

/**
 * delegated 模式：A收集上下文并委派，B拥有完整工具执行任务
 * - Agent A 负责收集上下文、规划任务、委派给 B
 * - Agent B 拥有全部工具，可自行读写文件、搜索和执行命令
 */
export const DELEGATED_MODE: ModeDefinition = {
  name: 'delegated',
  description: 'A收集上下文并委派，B拥有完整工具独立执行',
  coderHasTools: true,
  coderToolNames: ['read-file', 'write-file', 'edit-file', 'bash', 'glob', 'grep', 'memo'],
  coderSystemPrompt: `${CODER_IDENTITY}`,
};

/**
 * autonomous 模式：A规划，B自主执行
 * - Agent B 有工具，可自主读写文件和执行命令
 * - Agent A 只做高层规划和最终汇报
 */
export const AUTONOMOUS_MODE: ModeDefinition = {
  name: 'autonomous',
  description: 'A规划，B自主执行（适合能力强的模型）',
  coderHasTools: true,
  coderToolNames: ['read-file', 'write-file', 'edit-file', 'bash', 'glob', 'grep', 'memo'],
  coderSystemPrompt: `${CODER_IDENTITY}`,
};

/**
 * controlled 模式：A全权管理，B只返回代码
 * - Agent B 无工具，只输出代码/文本
 * - Agent A 负责所有文件操作
 */
export const CONTROLLED_MODE: ModeDefinition = {
  name: 'controlled',
  description: 'A全权管理，B只返回代码',
  coderHasTools: false,
  coderSystemPrompt: '你是被调度者派出的子 Agent。根据提供的代码和需求，只返回修改后的代码。不要自行操作文件，不要做额外改动。',
};

/**
 * 根据名称获取模式定义
 */
export function getMode(name: CollaborationMode): ModeDefinition {
  switch (name) {
    case 'delegated':
      return DELEGATED_MODE;
    case 'autonomous':
      return AUTONOMOUS_MODE;
    case 'controlled':
      return CONTROLLED_MODE;
    default:
      return DELEGATED_MODE;
  }
}
