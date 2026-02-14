import type { Message } from '../llm/types.js';

/**
 * 对话历史管理
 */
export class Conversation {
  private messages: Message[] = [];
  private systemPrompt: string = '';

  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }

  addMessage(message: Message): void {
    this.messages.push(message);
  }

  addUserMessage(content: string): void {
    this.messages.push({ role: 'user', content });
  }

  addAssistantMessage(message: Message): void {
    this.messages.push(message);
  }

  addToolResult(toolCallId: string, content: string): void {
    this.messages.push({
      role: 'tool',
      tool_call_id: toolCallId,
      content,
    });
  }

  /**
   * 获取完整的消息列表（包含系统提示词）
   */
  getMessages(): Message[] {
    const result: Message[] = [];
    if (this.systemPrompt) {
      result.push({ role: 'system', content: this.systemPrompt });
    }
    result.push(...this.messages);
    return result;
  }

  /**
   * 获取不含系统提示词的历史消息
   */
  getHistory(): Message[] {
    return [...this.messages];
  }

  /**
   * 清空对话历史（保留系统提示词）
   */
  clear(): void {
    this.messages = [];
  }

  /**
   * 获取消息数量
   */
  get length(): number {
    return this.messages.length;
  }
}
