import { Task } from './types.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface TaskValidatorPort {
  validateCreation(payload: any): ValidationResult;
  validateParentChange(taskId: string, newParentId: string | null, tasks: Map<string, Task>): ValidationResult;
}

export class StructuredTaskValidator implements TaskValidatorPort {
  public validateCreation(payload: any): ValidationResult {
    const errors: string[] = [];

    const title = payload?.title ? String(payload.title).trim() : '';
    if (title.length === 0) {
      errors.push('タイトルを入力してください。');
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
