import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import { marked } from 'marked';
import * as _markedTerminal from 'marked-terminal';
import { createTwoFilesPatch } from 'diff';

// 配置 marked 使用终端渲染器
// marked-terminal v7: named export 'markedTerminal' is the factory, default is the old Renderer class
const markedTerminal = (_markedTerminal as any).markedTerminal as () => any;
marked.use(markedTerminal());

/**
 * 渲染 Markdown 到终端
 */
export function renderMarkdown(text: string): string {
  return (marked.parse(text) as string).trim();
}

/**
 * 创建加载动画
 */
export function createSpinner(text: string): Ora {
  return ora({ text, color: 'cyan' });
}

/**
 * 打印用户输入提示
 */
export function printPrompt(): void {
  process.stdout.write(chalk.green('> '));
}

/**
 * 打印助手回复
 */
export function printAssistant(text: string): void {
  console.log(renderMarkdown(text));
}

/**
 * 打印流式内容（不换行）
 */
export function printStream(text: string): void {
  process.stdout.write(text);
}

/**
 * 打印工具调用信息
 */
export function printToolCall(toolName: string, params: Record<string, unknown>): void {
  let detail = '';
  if (toolName === 'bash' && params['command']) {
    detail = ` ${chalk.dim(String(params['command']).slice(0, 80))}`;
  } else if ((toolName === 'read-file' || toolName === 'write-file' || toolName === 'edit-file') && params['path']) {
    detail = ` ${chalk.dim(String(params['path']))}`;
  } else if (toolName === 'glob' && params['pattern']) {
    detail = ` ${chalk.dim(String(params['pattern']))}`;
  } else if (toolName === 'grep' && params['pattern']) {
    detail = ` ${chalk.dim(String(params['pattern']))}`;
  } else if (toolName === 'spawn-agents' && params['tasks']) {
    const tasks = params['tasks'] as { description: string }[];
    detail = ` ${chalk.dim(`${tasks.length} 个并行任务`)}`;
  } else if (toolName === 'todo' && params['action']) {
    const action = String(params['action']);
    const id = params['id'] ? ` [${params['id']}]` : '';
    detail = ` ${chalk.dim(`${action}${id}`)}`;
  } else if (toolName === 'memo' && params['action']) {
    const action = String(params['action']);
    const key = params['key'] ? ` [${params['key']}]` : '';
    detail = ` ${chalk.dim(`${action}${key}`)}`;
  }
  const icon = toolName === 'spawn-agents' ? '⚡' : toolName === 'todo' ? '📋' : toolName === 'memo' ? '📝' : '⚙';
  console.log(chalk.yellow(`  ${icon} ${toolName}`) + detail);
}

/**
 * 打印工具执行结果
 */
export function printToolResult(toolName: string, result: string, truncated: boolean): void {
  if (truncated) {
    console.log(chalk.dim(`  ✓ ${toolName} (输出已截断)`));
  } else {
    const lines = result.split('\n').length;
    console.log(chalk.dim(`  ✓ ${toolName} (${lines} 行)`));
  }
}

/**
 * 打印错误信息
 */
export function printError(message: string): void {
  console.error(chalk.red(`✗ ${message}`));
}

/**
 * 打印信息
 */
export function printInfo(message: string): void {
  console.log(chalk.cyan(`ℹ ${message}`));
}

/**
 * 打印警告
 */
export function printWarning(message: string): void {
  console.log(chalk.yellow(`⚠ ${message}`));
}

/**
 * 打印成功消息
 */
export function printSuccess(message: string): void {
  console.log(chalk.green(`✓ ${message}`));
}

/**
 * 打印 diff
 */
export function printDiff(oldContent: string, newContent: string, filePath: string): void {
  const patch = createTwoFilesPatch(filePath, filePath, oldContent, newContent);
  const lines = patch.split('\n');
  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      console.log(chalk.green(line));
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      console.log(chalk.red(line));
    } else if (line.startsWith('@@')) {
      console.log(chalk.cyan(line));
    } else {
      console.log(chalk.dim(line));
    }
  }
}

/**
 * 打印模式信息
 */
export function printModeInfo(mode: string, isDouble: boolean): void {
  const modeType = isDouble ? '双Agent' : '单Agent';
  console.log(chalk.cyan(`模式: ${modeType}${isDouble ? ` (${mode})` : ''}`));
}

/**
 * 打印欢迎信息
 */
export function printWelcome(modelName: string, mode: string): void {
  console.log(chalk.bold.cyan('\n  ZenCode') + chalk.dim(' - 极简 AI 编程助手\n'));
  console.log(chalk.dim(`  模型: ${modelName}`));
  console.log(chalk.dim(`  模式: ${mode}`));
  console.log(chalk.dim(`  输入 /help 查看命令，Ctrl+C 退出\n`));
}
