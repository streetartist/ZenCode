/**
 * Skill 系统类型定义
 *
 * Skill = 用户可通过 /name 调用的快捷命令
 * 执行时将 prompt 注入主 Agent 对话，由主 Agent 处理
 */

export interface Skill {
  name: string;           // 斜杠命令名（如 "commit"，用户输入 /commit 调用）
  description: string;    // 简短描述
  prompt: string;         // 提示词模板（支持 $ARGS 占位符替换用户参数）
}
