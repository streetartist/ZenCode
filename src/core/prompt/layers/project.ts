import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Layer 3 - 项目层（从 ZENCODE.md 加载）
 */
export async function buildProjectPrompt(): Promise<string | null> {
  try {
    const content = await fs.readFile(path.resolve('ZENCODE.md'), 'utf-8');
    return content.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Layer 4 - 用户自定义提示词（从指定路径加载）
 */
export async function loadUserPrompts(paths: string[]): Promise<string[]> {
  const prompts: string[] = [];
  for (const p of paths) {
    try {
      const resolved = p.startsWith('~')
        ? path.join(process.env['HOME'] || process.env['USERPROFILE'] || '', p.slice(1))
        : path.resolve(p);
      const content = await fs.readFile(resolved, 'utf-8');
      if (content.trim()) {
        prompts.push(content.trim());
      }
    } catch {
      // 跳过不存在的文件
    }
  }
  return prompts;
}
