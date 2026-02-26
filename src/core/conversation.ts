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
   * 清除历史消息中的 reasoning_content（新一轮对话开始时调用）
   * deepseek-reasoner 要求同一轮 tool call 循环内保留 reasoning_content，
   * 但新一轮用户问题开始时应清除以节省带宽，API 也会忽略旧的 reasoning_content
   */
  clearReasoningContent(): void {
    for (const msg of this.messages) {
      if (msg.reasoning_content !== undefined) {
        msg.reasoning_content = undefined;
      }
    }
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
