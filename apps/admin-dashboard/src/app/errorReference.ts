/** Short support reference for an error screen (e.g. "ERR-7K2Q9F"). Uses the platform CSPRNG. */
export function errorReference(): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const bytes = new Uint8Array(6);
  try {
    crypto.getRandomValues(bytes);
  } catch {
    /* no Web Crypto: an all-zero reference is still a valid label */
  }
  return `ERR-${Array.from(bytes, (b) => alphabet[b & 31]).join('')}`;
}
