import { describe, it, expect } from 'vitest';
import { StructuredTaskValidator } from '../../src/domain/task_validator.js';

describe('StructuredTaskValidator (with Optional Attributes)', () => {
  const validator = new StructuredTaskValidator();

  it('should validate task with only title provided', () => {
    const validPayload = {
      title: 'Quick Task',
    };

    const result = validator.validateCreation(validPayload);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should fail validation when title is empty', () => {
    const invalidPayload = {
      title: '   ',
    };

    const result = validator.validateCreation(invalidPayload);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('タイトルを入力してください。');
  });

  it('should allow optional intent and definitionOfDone', () => {
    const validPayload = {
      title: 'Task with Optional Attributes',
      intent: 'Optional Why description',
      definitionOfDone: [{ id: 'd1', text: 'Optional DoD', completed: false }],
    };

    const result = validator.validateCreation(validPayload);
    expect(result.valid).toBe(true);
  });
});
