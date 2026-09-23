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

  it('should prevent setting a parent task as a child of its own subtask (cycle validation)', () => {
    const tasks = new Map<string, any>([
      ['t-parent', { id: 't-parent', title: 'Parent', parentId: null }],
      ['t-child', { id: 't-child', title: 'Child', parentId: 't-parent' }],
    ]);

    // Try setting t-parent's parent to t-child (Creating a cycle A -> B -> A)
    const result = validator.validateParentChange('t-parent', 't-child', tasks);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('親タスクを自己の配下（子孫タスク）に移動することはできません。');
  });

  it('should enforce dueDate when status is IN_PROGRESS', () => {
    const resultNoDueDate = validator.validateStatusChange('IN_PROGRESS', null);
    expect(resultNoDueDate.valid).toBe(false);
    expect(resultNoDueDate.errors).toContain('進行中（IN_PROGRESS）に設定する場合は完了予定日（dueDate）が必須です。');

    const resultWithDueDate = validator.validateStatusChange('IN_PROGRESS', Date.now());
    expect(resultWithDueDate.valid).toBe(true);
  });

  it('should enforce 10+ char deletion reason for tasks with 3+ child subtasks', () => {
    const tasks = new Map<string, any>([
      ['parent', { id: 'parent', title: 'Parent', parentId: null }],
      ['c1', { id: 'c1', title: 'Child 1', parentId: 'parent' }],
      ['c2', { id: 'c2', title: 'Child 2', parentId: 'parent' }],
      ['c3', { id: 'c3', title: 'Child 3', parentId: 'parent' }],
    ]);

    const resultNoReason = validator.validateDeletion('parent', tasks, 'short');
    expect(resultNoReason.valid).toBe(false);
    expect(resultNoReason.errors).toContain('3つ以上の子要素を持つタスクを削除する際は、10文字以上の削除理由が必要です。');

    const resultValidReason = validator.validateDeletion('parent', tasks, 'このタスクはプロジェクト変更により不要となりました');
    expect(resultValidReason.valid).toBe(true);
  });
});
