import chalk from 'chalk';

/**
 * 确认处理函数类型
 * 接收提示文本，返回用户是否同意
 */
export type ConfirmHandler = (prompt: string) => Promise<boolean>;

/**
 * 结构化确认结果
 */
export interface ConfirmExecutionResult {
  approved: boolean;
  feedback?: string;
}

/**
 * 结构化确认处理函数类型
 * 接收工具名和参数，返回确认结果（含可选反馈）
 * 用于 TUI 模式，避免 chalk 格式化字符串
 */
export type StructuredConfirmHandler = (
  toolName: string,
  params: Record<string, unknown>,
) => Promise<ConfirmExecutionResult>;

/**
 * 全局确认处理函数（由 REPL 注入）
 * 默认实现：自动拒绝（安全兜底）
 */
let globalConfirmHandler: ConfirmHandler = async () => false;

/**
 * 结构化确认处理函数（由 TUI 注入）
 * 当设置时，confirmExecution 优先使用此 handler，跳过 stderr 输出
 */
let structuredConfirmHandler: StructuredConfirmHandler | null = null;

/**
 * 设置全局确认处理函数
 */
export function setConfirmHandler(handler: ConfirmHandler): void {
  globalConfirmHandler = handler;
}

/**
 * 设置结构化确认处理函数（TUI 模式使用）
 * 当设置后，confirmExecution 将直接传递 toolName 和 params，
 * 而不是格式化为 chalk 字符串输出到 stderr
 */
export function setStructuredConfirmHandler(handler: StructuredConfirmHandler | null): void {
  structuredConfirmHandler = handler;
}

/**
 * 格式化工具调用的详细信息
 */
function formatToolDetail(toolName: string, params: Record<string, unknown>): string {
  const lines: string[] = [];

  switch (toolName) {
    case 'bash':
      lines.push(`  ${chalk.dim('命令:')} ${chalk.white(String(params['command'] || ''))}`);
      break;
    case 'write-file':
      lines.push(`  ${chalk.dim('文件:')} ${chalk.white(String(params['path'] || ''))}`);
      if (params['content']) {
        const content = String(params['content']);
        const preview = content.length > 200 ? content.slice(0, 200) + '...' : content;
        lines.push(`  ${chalk.dim('内容:')} ${chalk.gray(preview.split('\n').join('\n        '))}`);
      }
      break;
    case 'edit-file':
      lines.push(`  ${chalk.dim('文件:')} ${chalk.white(String(params['path'] || ''))}`);
      if (params['old_string']) {
        const old = String(params['old_string']);
        const preview = old.length > 100 ? old.slice(0, 100) + '...' : old;
        lines.push(`  ${chalk.dim('替换:')} ${chalk.red(preview)}`);
      }
      if (params['new_string']) {
        const neu = String(params['new_string']);
        const preview = neu.length > 100 ? neu.slice(0, 100) + '...' : neu;
        lines.push(`  ${chalk.dim('为  :')} ${chalk.green(preview)}`);
      }
      break;
    case 'git':
      lines.push(`  ${chalk.dim('命令:')} git ${chalk.white(String(params['command'] || ''))}`);
      break;
    default:
      for (const [key, value] of Object.entries(params)) {
        const str = typeof value === 'string' ? value : JSON.stringify(value);
        lines.push(`  ${chalk.dim(key + ':')} ${str.slice(0, 120)}`);
      }
      break;
  }

  return lines.join('\n');
}

/**
 * 向用户确认是否执行危险操作
 */
export async function confirmExecution(
  toolName: string,
  params: Record<string, unknown>,
): Promise<ConfirmExecutionResult> {
  // TUI 模式：使用结构化 handler，跳过 stderr 输出
  if (structuredConfirmHandler) {
    return structuredConfirmHandler(toolName, params);
  }

  // REPL 模式：格式化并输出到 stderr
  const detail = formatToolDetail(toolName, params);
  const prompt = `\n${chalk.yellow('⚠')} ${chalk.bold('需要确认')} ${chalk.cyan(`[${toolName}]`)}\n${detail}\n`;

  process.stderr.write(prompt);
  const approved = await globalConfirmHandler(`${chalk.yellow('?')} 是否执行？(${chalk.green('y')}/${chalk.red('N')}) `);
  return { approved };
}
