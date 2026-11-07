/** Displayable native text only. Never include image or audio blobs. */
export function codexToolOutputText(output: unknown): string {
	if (typeof output === 'string') return output;
	if (Array.isArray(output)) {
		return output.every((value) => typeof value === 'number')
			? Buffer.from(output).toString('utf-8')
			: output
					.flatMap((value) =>
						value && typeof value === 'object' && typeof value.text === 'string' ? [value.text] : []
					)
					.join('\n');
	}
	return output == null ? '' : JSON.stringify(output);
}
