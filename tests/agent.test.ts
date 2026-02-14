import { describe, it, expect } from 'vitest';
import { Conversation } from '../src/core/conversation.js';

describe('Conversation', () => {
  it('should manage messages', () => {
    const conv = new Conversation();
    conv.setSystemPrompt('You are a helper.');
    conv.addUserMessage('hello');

    const messages = conv.getMessages();
    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe('system');
    expect(messages[1]!.role).toBe('user');
  });

  it('should support tool results', () => {
    const conv = new Conversation();
    conv.setSystemPrompt('test');
    conv.addUserMessage('test');
    conv.addAssistantMessage({
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: 'tc1',
        type: 'function',
        function: { name: 'read-file', arguments: '{"path":"test.txt"}' },
      }],
    });
    conv.addToolResult('tc1', 'file content');

    const messages = conv.getMessages();
    expect(messages).toHaveLength(4); // system + user + assistant + tool
    expect(messages[3]!.role).toBe('tool');
    expect(messages[3]!.tool_call_id).toBe('tc1');
  });

  it('should clear history but keep system prompt', () => {
    const conv = new Conversation();
    conv.setSystemPrompt('system');
    conv.addUserMessage('msg1');
    conv.addUserMessage('msg2');

    conv.clear();

    const messages = conv.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe('system');
  });
});
