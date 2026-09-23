import { Task } from './types.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface TaskValidatorPort {
  validateCreation(payload: any): ValidationResult;
  validateParentChange(taskId: string, newParentId: string | null, tasks: Map<string, Task>): ValidationResult;
  validateStatusChange(status: string, dueDate?: number | null): ValidationResult;
  validateDeletion(taskId: string, tasks: Map<string, Task>, reason?: string): ValidationResult;
}

export class StructuredTaskValidator implements TaskValidatorPort {
  public validateCreation(payload: any): ValidationResult {
    const errors: string[] = [];

    const title = payload?.title ? String(payload.title).trim() : '';
    if (title.length === 0) {
      errors.push('タイトルを入力してください。');
    }

    if (payload?.status === 'IN_PROGRESS' && (!payload?.dueDate || payload.dueDate <= 0)) {
      errors.push('進行中（IN_PROGRESS）に設定する場合は完了予定日（dueDate）が必須です。');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  public validateStatusChange(status: string, dueDate?: number | null): ValidationResult {
    const errors: string[] = [];

    if (status === 'IN_PROGRESS' && (!dueDate || dueDate <= 0)) {
      errors.push('進行中（IN_PROGRESS）に設定する場合は完了予定日（dueDate）が必須です。');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  public validateDeletion(taskId: string, tasks: Map<string, Task>, reason?: string): ValidationResult {
    const errors: string[] = [];

    let childCount = 0;
    for (const t of tasks.values()) {
      if (t.parentId === taskId) {
        childCount++;
      }
    }

    if (childCount >= 3) {
      const cleanReason = reason ? reason.trim() : '';
      if (cleanReason.length < 10) {
        errors.push('3つ以上の子要素を持つタスクを削除する際は、10文字以上の削除理由が必要です。');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  public validateParentChange(taskId: string, newParentId: string | null, tasks: Map<string, Task>): ValidationResult {
    const errors: string[] = [];

    if (!newParentId) {
      return { valid: true, errors: [] };
    }

    if (taskId === newParentId) {
      errors.push('タスク自身を親タスクに設定することはできません。');
      return { valid: false, errors };
    }

    // Cycle detection: Ensure newParentId is not a descendant of taskId
    let currentId: string | null | undefined = newParentId;
    const visited = new Set<string>();

    while (currentId) {
      if (currentId === taskId) {
        errors.push('親タスクを自己の配下（子孫タスク）に移動することはできません。');
        return { valid: false, errors };
      }
      if (visited.has(currentId)) {
        break;
      }
      visited.add(currentId);
      const parentTask = tasks.get(currentId);
      currentId = parentTask ? parentTask.parentId : null;
    }

    return { valid: true, errors: [] };
  }
}
