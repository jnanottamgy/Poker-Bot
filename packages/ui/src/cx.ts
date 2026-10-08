/** Joins truthy class names. Tiny and dependency-free on purpose. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
