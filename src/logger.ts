/** Remove session secrets from anything that might be written to a log. */
export function scrub(value: unknown, secrets: string[]): unknown {
  const usable = secrets.filter((secret) => typeof secret === 'string' && secret.length >= 8);
  const cleanString = (input: string) => {
    let out = input;
    for (const secret of usable) out = out.split(secret).join('[redacted]');
    return out;
  };
  if (typeof value === 'string') return cleanString(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) return value;
  if (Array.isArray(value)) return value.map((item) => scrub(item, usable));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (/token|authorization|cookie|guestUrl|qr/i.test(key)) {
        out[key] = '[redacted]';
        continue;
      }
      out[key] = scrub(item, usable);
    }
    return out;
  }
  return undefined;
}

export function formatLog(message: string, fields: Record<string, unknown> | undefined, secrets: string[]): string {
  const payload = scrub({ message, ...fields }, secrets);
  return `[localcast] ${JSON.stringify(payload)}`;
}
