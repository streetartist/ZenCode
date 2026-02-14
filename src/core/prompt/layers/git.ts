/**
 * Layer 2 - Git 层（检测到 .git 时加载）
 */
export function buildGitPrompt(): string {
  return `# Git 操作

当前项目使用 git 管理。

提交规范：
- 只在用户明确要求时才创建 commit
- 用 git diff 查看变更，再写 commit message
- commit message 描述"为什么"而非"改了什么"

安全规则：
- 不要 force push、reset --hard、checkout .、clean -f 等破坏性操作，除非用户明确要求
- 不要 --no-verify 跳过 hook，除非用户明确要求
- 优先创建新 commit，不要 --amend 修改已有 commit，除非用户明确要求（hook 失败后 amend 会破坏上一个 commit）
- git add 时指定具体文件，避免 git add -A 意外暂存敏感文件（.env、credentials 等）
- 不要使用交互式标志（git rebase -i、git add -i），CLI 环境不支持
- 不要修改 git config`;
}
