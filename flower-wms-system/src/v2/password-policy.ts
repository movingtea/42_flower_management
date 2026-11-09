export function isStrongV2Password(password: string, username: string): boolean {
  return password.trim().length >= 16 &&
    Buffer.byteLength(password, "utf8") <= 72 &&
    !password.toLowerCase().includes(username.toLowerCase()) &&
    new Set(password).size >= 8;
}
