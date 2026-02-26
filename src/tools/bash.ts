import { exec } from 'node:child_process';
import type { Tool, ToolResult } from './types.js';

const DEFAULT_TIMEOUT = 120_000; // 2 minutes
const IS_WIN = process.platform === 'win32';

/**
 * Windows cmd.exe 默认用系统代码页（如 GBK/CP936）输出，
 * 需要先以 buffer 读取再用正确编码解码，否则中文乱码。
 */
function decodeBuffer(buf: Buffer): string {
  if (!IS_WIN) return buf.toString('utf-8');
  try {
    // Node.js 不原生支持 GBK，优先尝试 TextDecoder
    const decoder = new TextDecoder('gbk');
    return decoder.decode(buf);
  } catch {
    return buf.toString('utf-8');
  }
}

export const bashTool: Tool = {
  name: 'bash',
  description: IS_WIN
    ? '执行系统命令（shell: cmd.exe）。用于运行构建、测试、git 等。Windows 环境请使用 Windows 命令（dir、type、copy）或 Python 跨平台命令，不要使用 Unix 命令（ls、cat、cp）。不要用 bash 做文件读写（用 read-file/edit-file/write-file）或搜索（用 glob/grep）。'
    : '执行 shell 命令（shell: /bin/bash）。用于运行构建、测试、git 操作等系统命令。不要用 bash 做文件读写（用 read-file/edit-file/write-file）或搜索（用 glob/grep）。',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: '要执行的 shell 命令',
      },
      timeout: {
        type: 'number',
        description: '超时时间（毫秒），默认 120000',
      },
    },
    required: ['command'],
  },
  permissionLevel: 'confirm',

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const command = params['command'] as string;
    const timeout = (params['timeout'] as number) || DEFAULT_TIMEOUT;

    return new Promise<ToolResult>((resolve) => {
      exec(
        command,
        {
          cwd: process.cwd(),
          timeout,
          maxBuffer: 1024 * 1024 * 10, // 10MB
          shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash',
          encoding: 'buffer',
        },
        (error, stdoutBuf, stderrBuf) => {
          const stdout = stdoutBuf ? decodeBuffer(stdoutBuf) : '';
          const stderr = stderrBuf ? decodeBuffer(stderrBuf) : '';

          let output = '';
          if (stdout) output += stdout;
          if (stderr) output += (output ? '\n' : '') + `[stderr]\n${stderr}`;
          if (error && error.killed) {
            output += `\n[命令超时，已终止]`;
          } else if (error && !stdout && !stderr) {
            output = `命令执行失败：${error.message}`;
          }

          resolve({ content: output || '（无输出）' });
        },
      );
    });
  },
};
