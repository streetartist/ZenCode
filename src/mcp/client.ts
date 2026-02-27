import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

/**
 * 简单的 MCP (Model Context Protocol) 客户端
 *
 * 通过 stdio 与 MCP 服务器通信，使用 JSON-RPC 2.0 协议
 */

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export class McpClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();
  private buffer = '';
  private tools: McpTool[] = [];

  constructor(
    private command: string,
    private args: string[] = [],
  ) {
    super();
  }

  /**
   * 启动 MCP 服务器并初始化
   */
  async connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.process = spawn(this.command, this.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.process.stdout?.on('data', (data: Buffer) => {
        this.buffer += data.toString();
        this.processBuffer();
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        this.emit('error', new Error(`MCP stderr: ${data.toString()}`));
      });

      this.process.on('error', (err) => {
        reject(err);
      });

      this.process.on('close', (code) => {
        this.emit('close', code);
      });

      // 初始化
      this.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'zencode', version: '0.4.1' },
      }).then(() => {
        // 发送 initialized 通知
        this.sendNotification('notifications/initialized');
        resolve();
      }).catch(reject);
    });
  }

  /**
   * 获取可用工具列表
   */
  async listTools(): Promise<McpTool[]> {
    const result = await this.sendRequest('tools/list', {}) as { tools: McpTool[] };
    this.tools = result.tools || [];
    return this.tools;
  }

  /**
   * 调用 MCP 工具
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await this.sendRequest('tools/call', { name, arguments: args });
    return result;
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.pendingRequests.clear();
  }

  private sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      this.pendingRequests.set(id, { resolve, reject });
      this.process?.stdin?.write(JSON.stringify(request) + '\n');

      // 超时
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`MCP request timeout: ${method}`));
        }
      }, 30_000);
    });
  }

  private sendNotification(method: string, params?: Record<string, unknown>): void {
    const notification = {
      jsonrpc: '2.0',
      method,
      params,
    };
    this.process?.stdin?.write(JSON.stringify(notification) + '\n');
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const response = JSON.parse(line) as JsonRpcResponse;
        if (response.id !== undefined) {
          const pending = this.pendingRequests.get(response.id);
          if (pending) {
            this.pendingRequests.delete(response.id);
            if (response.error) {
              pending.reject(new Error(response.error.message));
            } else {
              pending.resolve(response.result);
            }
          }
        }
      } catch {
        // 忽略解析失败的行
      }
    }
  }
}
