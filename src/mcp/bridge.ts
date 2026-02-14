import type { Tool, ToolResult } from '../tools/types.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { McpClient } from './client.js';
import type { McpServerConfig } from '../config/types.js';

/**
 * 将 MCP 工具桥接到 ZenCode 工具注册表
 *
 * 每个 MCP 工具被包装成符合 ZenCode Tool 接口的对象
 */
export async function bridgeMcpTools(
  mcpClient: McpClient,
  registry: ToolRegistry,
  serverName: string,
): Promise<string[]> {
  const mcpTools = await mcpClient.listTools();
  const registeredNames: string[] = [];

  for (const mcpTool of mcpTools) {
    const toolName = `mcp-${serverName}-${mcpTool.name}`;

    const tool: Tool = {
      name: toolName,
      description: mcpTool.description || `MCP 工具: ${mcpTool.name}`,
      parameters: {
        type: 'object',
        properties: (mcpTool.inputSchema as any)?.properties || {},
        required: (mcpTool.inputSchema as any)?.required || [],
      },
      permissionLevel: 'confirm', // MCP 工具默认需要确认
      async execute(params: Record<string, unknown>): Promise<ToolResult> {
        try {
          const result = await mcpClient.callTool(mcpTool.name, params);
          // MCP 工具结果可能是各种格式
          if (typeof result === 'string') {
            return { content: result };
          }
          if (result && typeof result === 'object') {
            const r = result as Record<string, unknown>;
            // MCP 标准返回格式
            if (Array.isArray(r['content'])) {
              const textContent = (r['content'] as Array<{ type: string; text?: string }>)
                .filter((c) => c.type === 'text' && c.text)
                .map((c) => c.text)
                .join('\n');
              return { content: textContent || JSON.stringify(result, null, 2) };
            }
          }
          return { content: JSON.stringify(result, null, 2) };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return { content: `MCP 工具执行错误：${msg}` };
        }
      },
    };

    registry.register(tool);
    registeredNames.push(toolName);
  }

  return registeredNames;
}

/**
 * 连接所有配置的 MCP 服务器并桥接工具
 */
export async function connectMcpServers(
  servers: McpServerConfig[],
  registry: ToolRegistry,
): Promise<McpClient[]> {
  const { McpClient } = await import('./client.js');
  const clients: McpClient[] = [];

  for (const serverConfig of servers) {
    try {
      const client = new McpClient(serverConfig.command, serverConfig.args || []);
      await client.connect();
      await bridgeMcpTools(client, registry, serverConfig.name);
      clients.push(client);
    } catch (error) {
      console.error(`MCP 服务器 "${serverConfig.name}" 连接失败：${error instanceof Error ? error.message : error}`);
    }
  }

  return clients;
}
