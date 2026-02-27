import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import { Marked } from 'marked';
import * as _markedTerminal from 'marked-terminal';
import { createTwoFilesPatch } from 'diff';

// 配置 marked 使用终端渲染器
const markedTerminal = (_markedTerminal as any).markedTerminal as (options?: any) => any;
const marked = new Marked(markedTerminal({
  reflowText: false,
  code: chalk.cyan,
  codespan: chalk.yellow,
  heading: chalk.bold.magenta,
  hr: () => chalk.dim('─'.repeat(Math.max(0, (process.stdout.columns || 80) - 12))),
  strong: chalk.bold,
  em: chalk.italic,
  link: chalk.blue,
  href: chalk.blue.underline,
}));

// 补充修复: 确保列表项中的嵌套行内元素（如加粗）能正确渲染
marked.use({
  renderer: {
    text(this: any, token: any) {
      if (typeof token === 'object' && token.tokens) {
        return this.parser.parseInline(token.tokens);
      }
      return typeof token === 'string' ? token : token.text;
    }
  }
});

/**
 * 渲染 Markdown 到终端
 */
export function renderMarkdown(text: string): string {
  const rendered = (marked.parse(text) as string) as string;
  // 移除末尾换行，由 ink 组件控制布局
  return rendered.replace(/\n+$/, '');
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
  }
  const icon = toolName === 'spawn-agents' ? '>>' : toolName === 'todo' ? '#' : '>';
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
/**
 * 打印欢迎信息
 */
export function printWelcome(modelName: string): void {
  console.log(chalk.bold.cyan('\n  ZenCode') + chalk.dim(' - 极简 AI 编程助手\n'));
  console.log(chalk.dim(`  模型: ${modelName}`));
  console.log(chalk.dim(`  输入 /help 查看命令，Ctrl+C 退出\n`));
}
