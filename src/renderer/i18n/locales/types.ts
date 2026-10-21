/**
 * A translation of one English catalog area. Every key is optional (a missing
 * one falls back to English at runtime and is flagged by the completeness
 * test), but an UNKNOWN key is a compile error, so a renamed English key
 * cannot leave an orphaned translation behind.
 */
export type AreaTranslation<T> = { [K in keyof T]?: string };
