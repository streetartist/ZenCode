import { ToolRegistry } from '../tools/registry.js';
import { readFileTool } from '../tools/read-file.js';
import { writeFileTool } from '../tools/write-file.js';
import { editFileTool } from '../tools/edit-file.js';
import { bashTool } from '../tools/bash.js';
import { globTool } from '../tools/glob.js';
import { grepTool } from '../tools/grep.js';

/**
 * 注册所有核心工具
 */
export function registerCoreTools(registry: ToolRegistry): void {
  registry.register(readFileTool);
  registry.register(writeFileTool);
  registry.register(editFileTool);
  registry.register(bashTool);
  registry.register(globTool);
  registry.register(grepTool);
}
