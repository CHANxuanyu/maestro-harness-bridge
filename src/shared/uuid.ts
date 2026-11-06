/**
 * Simple UUID v4 generator.
 *
 * Generates RFC 4122 compliant version 4 UUIDs using Math.random().
 * This is suitable for non-cryptographic purposes like session IDs
 * and history entry IDs.
 *
 * @returns A UUID v4 string (e.g., "550e8400-e29b-41d4-a716-446655440000")
 */
export function generateUUID(): string {
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0;
		const v = c === 'x' ? r : (r & 0x3) | 0x8;
		return v.toString(16);
	});
}

/**
 * Generate a random unique identifier.
 *
 * Prefers the crypto-secure `crypto.randomUUID()` when available. Safari and
 * other browsers gate that behind a secure context (HTTPS or localhost), so
 * over plain-HTTP origins (Tailscale IPs, LAN URLs) the API is `undefined`
 * and would throw on call. Fall back to the Math.random-based UUID v4 - fine
 * for renderer-side correlation IDs, tab IDs, and request IDs.
 */
export const generateId = (): string => {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	return generateUUID();
};
