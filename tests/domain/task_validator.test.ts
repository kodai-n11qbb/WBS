import { describe, it, expect } from 'vitest';
import { StructuredTaskValidator } from '../../src/domain/task_validator.js';

describe('StructuredTaskValidator', () => {
  const validator = new StructuredTaskValidator();

  it('should validate valid structured task payload', () => {
    const validPayload = {
      title: 'Fix UDP Peer Discovery',
      intent: 'Ensure nodes on the same LAN can exchange events without packet loss.',
      definitionOfDone: [
        { id: 'dod-1', text: 'Write integration test', completed: false },
        { id: 'dod-2', text: 'Verify multicast socket binding', completed: false },
      ],
      priority: 'HIGH',
    };

    const result = validator.validateCreation(validPayload);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should fail validation when title is too short or empty', () => {
    const invalidPayload = {
      title: '  ',
      intent: 'Some intent',
      definitionOfDone: [{ id: 'dod-1', text: 'DoD 1', completed: false }],
    };

    const result = validator.validateCreation(invalidPayload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('タイトルは空白を除いて3文字以上入力してください。');
  });

  it('should fail validation when intent (purpose) is missing', () => {
    const invalidPayload = {
      title: 'Valid Title',
      intent: '  ',
      definitionOfDone: [{ id: 'dod-1', text: 'DoD 1', completed: false }],
    };

    const result = validator.validateCreation(invalidPayload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('タスクの目的・背景(Why)の記述は必須です。');
  });

  it('should fail validation when definitionOfDone is empty', () => {
    const invalidPayload = {
      title: 'Valid Title',
      intent: 'Valid Intent',
      definitionOfDone: [],
    };

    const result = validator.validateCreation(invalidPayload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('完了定義 (Definition of Done) チェックリストを最低1つ追加してください。');
  });
});
