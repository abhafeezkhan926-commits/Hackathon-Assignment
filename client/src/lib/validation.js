export function isValidUsername(value) {
  return /^[a-zA-Z0-9._-]{3,30}$/.test(String(value || '').trim());
}
export function isStrongPassword(value) {
  const text = String(value || '');
  return text.length >= 12 && text.length <= 128 && /[A-Z]/.test(text) && /[a-z]/.test(text) && /[0-9]/.test(text);
}
export function normalizeIdentifier(value) {
  return String(value || '').trim().toLowerCase();
}
