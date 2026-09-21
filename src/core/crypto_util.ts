import { webcrypto } from 'node:crypto';

export const crypto = {
  randomUUID(): string {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
    return (webcrypto as any).randomUUID();
  },
};
