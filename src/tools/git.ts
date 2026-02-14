import { exec } from 'node:child_process';
import type { Tool, ToolResult } from './types.js';

export const gitTool: Tool = {
  name: 'git',
  description: '执行 git 命令。支持常见的版本控制操作。',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'git 子命令和参数，如 "status"、"diff"、"log --oneline -10"',
      },
    },
    required: ['command'],
  },
  permissionLevel: 'confirm',

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const gitCommand = params['command'] as string;
    const fullCommand = `git ${gitCommand}`;

    return new Promise<ToolResult>((resolve) => {
      exec(
        fullCommand,
        {
          cwd: process.cwd(),
          timeout: 30_000,
          maxBuffer: 1024 * 1024 * 5,
        },
        (error, stdout, stderr) => {
          let output = '';
          if (stdout) output += stdout;
          if (stderr) output += (output ? '\n' : '') + stderr;
          if (error && !stdout && !stderr) {
            output = `git 命令执行失败：${error.message}`;
          }
          resolve({ content: output || '（无输出）' });
        },
      );
    });
  },
};
