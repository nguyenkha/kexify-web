/** `document.documentElement`, or null without a DOM (`bun test`: Bun 1.4 gives each test file its own globals). */
export function docRoot(): HTMLElement | null {
  return typeof document === "undefined" ? null : document.documentElement;
}
