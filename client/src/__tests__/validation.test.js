import { describe, expect, it } from 'vitest';
import { isStrongPassword, isValidUsername, normalizeIdentifier } from '../lib/validation.js';

describe('account form validation helpers', () => {
  it('accepts allowed usernames and rejects short or malformed values', () => {
    expect(isValidUsername('hafeez.dev')).toBe(true);
    expect(isValidUsername('ab')).toBe(false);
    expect(isValidUsername('bad name')).toBe(false);
  });
  it('requires a long password with uppercase, lowercase and a number', () => {
    expect(isStrongPassword('LongPassphrase7')).toBe(true);
    expect(isStrongPassword('short7A')).toBe(false);
    expect(isStrongPassword('lowercaseonly123')).toBe(false);
  });
  it('normalizes login identifiers', () => {
    expect(normalizeIdentifier('  Admin@Example.COM ')).toBe('admin@example.com');
  });
});
