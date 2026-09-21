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
    if (title.length === 0) {
      errors.push('タイトルを入力してください。');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
