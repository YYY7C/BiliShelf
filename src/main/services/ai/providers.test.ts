import { describe, expect, it, vi } from 'vitest';
import { AiChatError, parseOpenAiResponse } from './providers';

// providers.ts 会通过 ./config 读取 electron 的 safeStorage，单测里只测响应解析，直接替换掉。
vi.mock('./config', () => ({ getProviderRuntime: vi.fn() }));

function capture(fn: () => unknown): AiChatError {
  try {
    fn();
  } catch (error) {
    return error as AiChatError;
  }
  throw new Error('expected throw');
}

describe('parseOpenAiResponse', () => {
  it('推理占满预算、正文为空时给出截断原因而不是 JSON 错误', () => {
    const response = {
      choices: [
        {
          finish_reason: 'length',
          message: {
            content: '',
            reasoning_content: '先分析这个库的主题……'
          }
        }
      ],
      usage: { prompt_tokens: 4119, completion_tokens: 2400 }
    };

    expect(() => parseOpenAiResponse(response, 2400)).toThrow(/max_tokens=2400/);
    expect(() => parseOpenAiResponse(response, 2400)).toThrow(/截断/);
    // 关键：必须标记为 truncated，否则重试逻辑会把它当成「网关拒绝 max_tokens」而把预算调小
    expect(capture(() => parseOpenAiResponse(response, 2400)).kind).toBe('truncated');
  });

  it('正文为空但没截断时标记为 empty，避免被当成截断去加倍预算', () => {
    const error = capture(() =>
      parseOpenAiResponse({ choices: [{ finish_reason: 'stop', message: { content: '' } }] }, 8000)
    );

    expect(error.kind).toBe('empty');
    expect(error.message).toContain('空内容');
  });

  it('正常返回时附带 finishReason', () => {
    const result = parseOpenAiResponse(
      {
        choices: [
          {
            finish_reason: 'stop',
            message: { content: '{"summary":"舞蹈库"}', reasoning_content: '思考中' }
          }
        ],
        usage: { prompt_tokens: 100, completion_tokens: 20 }
      },
      8000
    );

    expect(result.text).toBe('{"summary":"舞蹈库"}');
    expect(result.finishReason).toBe('stop');
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 20 });
  });

  it('只有工具调用、没有正文时不算空响应', () => {
    const result = parseOpenAiResponse(
      {
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              content: null,
              tool_calls: [
                { id: 'call_1', function: { name: 'identify_music', arguments: '{"seconds":15}' } }
              ]
            }
          }
        ]
      },
      2000
    );

    expect(result.toolCalls).toEqual([{ id: 'call_1', name: 'identify_music', args: { seconds: 15 } }]);
  });
});
