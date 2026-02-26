/**
 * Layer - 并行子 Agent 提示词层
 *
 * 核心原则：让"并行"成为默认行为，而非可选项。
 * LLM 天然倾向串行调用工具，必须用强指令扭转这一惯性。
 */
export function buildParallelPrompt(): string {
  return `# 并行执行（重要）

当需要读取、搜索或分析 2 个以上独立目标时，必须使用 spawn-agents 并行执行，不要逐个串行调用。

规则：
- 需要读 2+ 个文件 → spawn-agents 并行读取
- 需要搜索 2+ 个模式 → spawn-agents 并行搜索
- 需要了解 2+ 个模块 → spawn-agents 并行分析
- 只有 1 个目标 → 直接用工具，无需 spawn-agents

示例 - 用户说"帮我理解认证模块"：
  正确：spawn-agents 同时读 auth controller、auth service、auth middleware、auth types
  错误：先 read-file controller，再 read-file service，再 read-file middleware...

每个子 Agent 有独立对话，默认可用 read-file、glob、grep。`;
}
