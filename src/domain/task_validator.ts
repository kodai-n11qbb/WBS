import { DefinitionOfDoneItem } from './types.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface TaskValidatorPort {
  validateCreation(payload: any): ValidationResult;
}

export class StructuredTaskValidator implements TaskValidatorPort {
  public validateCreation(payload: any): ValidationResult {
    const errors: string[] = [];

    const title = payload?.title ? String(payload.title).trim() : '';
    if (title.length < 3) {
      errors.push('タイトルは空白を除いて3文字以上入力してください。');
    }

    const intent = payload?.intent ? String(payload.intent).trim() : '';
    if (!intent) {
      errors.push('タスクの目的・背景(Why)の記述は必須です。');
    }

    const dod: DefinitionOfDoneItem[] = Array.isArray(payload?.definitionOfDone)
      ? payload.definitionOfDone
      : [];
    const validDodItems = dod.filter((item) => item && item.text && item.text.trim().length > 0);
    if (validDodItems.length === 0) {
      errors.push('完了定義 (Definition of Done) チェックリストを最低1つ追加してください。');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
