import { describe, it, expect } from '@jest/globals';
import { shouldSpeak, isIdleNotification, stripMarkdown, prepareProtocolText, prepareText, isDuplicate } from '../lib.mjs';

describe('shouldSpeak', () => {
  it('returns false for empty text', () => {
    expect(shouldSpeak({ text: '' })).toBe(false);
  });

  it('returns false for whitespace-only text', () => {
    expect(shouldSpeak({ text: '   \t\n  ' })).toBe(false);
  });

  it('returns false for missing text field', () => {
    expect(shouldSpeak({})).toBe(false);
  });

  it('returns false for idle_notification JSON', () => {
    expect(shouldSpeak({ text: '{"type":"idle_notification"}' })).toBe(false);
  });

  it('returns true for regular text messages', () => {
    expect(shouldSpeak({ text: 'Hello team!' })).toBe(true);
  });

  it('returns true for task_assignment JSON', () => {
    expect(shouldSpeak({ text: '{"type":"task_assignment","subject":"Fix bug"}' })).toBe(true);
  });

  it('returns true for shutdown_request JSON', () => {
    expect(shouldSpeak({ text: '{"type":"shutdown_request","reason":"done"}' })).toBe(true);
  });

  it('returns true for non-JSON text starting with {', () => {
    expect(shouldSpeak({ text: '{not valid json at all' })).toBe(true);
  });
});

describe('isIdleNotification', () => {
  it('returns true for {"type":"idle_notification"}', () => {
    expect(isIdleNotification('{"type":"idle_notification"}')).toBe(true);
  });

  it('returns false for plain text', () => {
    expect(isIdleNotification('hello world')).toBe(false);
  });

  it('returns false for text not starting with {', () => {
    expect(isIdleNotification('some text {"type":"idle_notification"}')).toBe(false);
  });

  it('returns false for JSON with different type', () => {
    expect(isIdleNotification('{"type":"task_assignment"}')).toBe(false);
  });

  it('returns false for malformed JSON starting with {', () => {
    expect(isIdleNotification('{not json}')).toBe(false);
  });
});

describe('stripMarkdown', () => {
  it('removes code blocks', () => {
    expect(stripMarkdown('before\n```js\nconst x = 1;\n```\nafter')).toBe('before. after');
  });

  it('removes inline code backticks', () => {
    expect(stripMarkdown('use `const` here')).toBe('use const here');
  });

  it('converts links to text only', () => {
    expect(stripMarkdown('see [docs](https://example.com) now')).toBe('see docs now');
  });

  it('removes bold markers', () => {
    expect(stripMarkdown('this is **bold** text')).toBe('this is bold text');
  });

  it('removes italic markers', () => {
    expect(stripMarkdown('this is *italic* text')).toBe('this is italic text');
  });

  it('removes heading markers', () => {
    expect(stripMarkdown('## Heading Here')).toBe('Heading Here');
  });

  it('removes table rows', () => {
    expect(stripMarkdown('| col1 | col2 |')).toBe('');
  });

  it('removes list item markers', () => {
    expect(stripMarkdown('- item one\n* item two')).toBe('item one\nitem two');
  });

  it('collapses multiple newlines to ". "', () => {
    expect(stripMarkdown('line one\n\n\nline two')).toBe('line one. line two');
  });

  it('trims whitespace', () => {
    expect(stripMarkdown('  hello  ')).toBe('hello');
  });
});

describe('prepareProtocolText', () => {
  it('formats task_assignment with assignedBy and subject', () => {
    const parsed = { type: 'task_assignment', assignedBy: 'lead', subject: 'Fix bug' };
    expect(prepareProtocolText(parsed, 'someone')).toBe('lead assigned task: Fix bug');
  });

  it('formats task_assignment falling back to from when no assignedBy', () => {
    const parsed = { type: 'task_assignment', subject: 'Fix bug' };
    expect(prepareProtocolText(parsed, 'lead')).toBe('lead assigned task: Fix bug');
  });

  it('formats shutdown_request with reason', () => {
    const parsed = { type: 'shutdown_request', reason: 'all done' };
    expect(prepareProtocolText(parsed, 'agent-1')).toBe('agent-1 requests shutdown: all done');
  });

  it('formats shutdown_request with default reason', () => {
    const parsed = { type: 'shutdown_request' };
    expect(prepareProtocolText(parsed, 'agent-1')).toBe('agent-1 requests shutdown: work complete');
  });

  it('formats shutdown_approved', () => {
    const parsed = { type: 'shutdown_approved' };
    expect(prepareProtocolText(parsed, 'agent-2')).toBe('agent-2 has shut down');
  });

  it('formats plan_approval_request', () => {
    const parsed = { type: 'plan_approval_request' };
    expect(prepareProtocolText(parsed, 'researcher')).toBe('researcher submitted a plan for approval');
  });

  it('formats unknown types with underscores replaced by spaces', () => {
    const parsed = { type: 'custom_event_type' };
    expect(prepareProtocolText(parsed, 'bot')).toBe('bot: custom event type');
  });
});

describe('prepareText', () => {
  it('prefixes regular messages with "{from} says: "', () => {
    expect(prepareText({ from: 'alice', text: 'hello' })).toBe('alice says: hello');
  });

  it('prefers summary over text when both present', () => {
    expect(prepareText({ from: 'bob', text: 'long message', summary: 'short' })).toBe('bob says: short');
  });

  it('strips markdown from message text', () => {
    expect(prepareText({ from: 'agent', text: 'use **bold** here' })).toBe('agent says: use bold here');
  });

  it('truncates to 500 chars with "..." suffix', () => {
    const longText = 'a'.repeat(600);
    const result = prepareText({ from: 'x', text: longText });
    expect(result.length).toBe(500);
    expect(result.endsWith('...')).toBe(true);
    // "x says: " is 9 chars, so 497 - 9 = 488 'a's then "..."
    expect(result).toBe('x says: ' + 'a'.repeat(489) + '...');
  });

  it('handles missing from field (defaults to "unknown")', () => {
    expect(prepareText({ text: 'hello' })).toBe('unknown says: hello');
  });

  it('detects and delegates protocol messages to prepareProtocolText', () => {
    const msg = { from: 'lead', text: '{"type":"shutdown_approved"}' };
    expect(prepareText(msg)).toBe('lead has shut down');
  });

  it('treats malformed JSON as regular text', () => {
    const msg = { from: 'bot', text: '{not json' };
    expect(prepareText(msg)).toBe('bot says: {not json');
  });
});

describe('isDuplicate', () => {
  it('returns false for first occurrence', () => {
    const seen = new Set();
    expect(isDuplicate({ from: 'a', text: 'hello', timestamp: '1' }, seen)).toBe(false);
  });

  it('returns true for duplicate (same from+text+timestamp)', () => {
    const seen = new Set();
    const msg = { from: 'a', text: 'hello', timestamp: '1' };
    isDuplicate(msg, seen);
    expect(isDuplicate(msg, seen)).toBe(true);
  });

  it('returns false for different text', () => {
    const seen = new Set();
    isDuplicate({ from: 'a', text: 'hello', timestamp: '1' }, seen);
    expect(isDuplicate({ from: 'a', text: 'world', timestamp: '1' }, seen)).toBe(false);
  });

  it('returns false for different from', () => {
    const seen = new Set();
    isDuplicate({ from: 'a', text: 'hello', timestamp: '1' }, seen);
    expect(isDuplicate({ from: 'b', text: 'hello', timestamp: '1' }, seen)).toBe(false);
  });

  it('returns false for different timestamp', () => {
    const seen = new Set();
    isDuplicate({ from: 'a', text: 'hello', timestamp: '1' }, seen);
    expect(isDuplicate({ from: 'a', text: 'hello', timestamp: '2' }, seen)).toBe(false);
  });

  it('evicts oldest hash when set exceeds 100', () => {
    const seen = new Set();
    // Add 100 unique messages
    for (let i = 0; i < 100; i++) {
      isDuplicate({ from: 'a', text: `msg-${i}`, timestamp: '1' }, seen);
    }
    expect(seen.size).toBe(100);

    // Adding the 101st should evict the first
    isDuplicate({ from: 'a', text: 'msg-new', timestamp: '1' }, seen);
    expect(seen.size).toBe(100);

    // The first message should no longer be considered a duplicate
    expect(isDuplicate({ from: 'a', text: 'msg-0', timestamp: '1' }, seen)).toBe(false);
  });
});
