export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export function requiredText(value, name, max) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    throw new HttpError(400, `Invalid ${name}.`);
  return value.trim();
}
export function password(value) {
  if (
    typeof value !== 'string' ||
    value.length < 12 ||
    value.length > 128 ||
    !/[A-Z]/.test(value) ||
    !/[a-z]/.test(value) ||
    !/[0-9]/.test(value)
  ) {
    throw new HttpError(400, 'Use 12–128 characters with uppercase, lowercase and a number.');
  }
  return value;
}
export function clientInput(input) {
  const email = requiredText(input.email, 'email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Invalid email.');
  return {
    email,
    company: requiredText(input.company, 'company', 160),
    display_name: requiredText(input.display_name, 'contact name', 120),
    password: password(input.password),
  };
}
export function id(value) {
  if (typeof value !== 'string' || !UUID.test(value))
    throw new HttpError(400, 'Invalid identifier.');
  return value;
}
