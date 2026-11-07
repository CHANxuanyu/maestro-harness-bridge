/**
 * Codex message content structure
 */
export interface CodexMessageContent {
	type: string;
	text?: string;
	image_url?: string | { url?: string };
	// Tool use fields
	tool?: string;
	args?: unknown;
	output?: string;
}

/**
 * Extract text from Codex message content array
 */
export function extractTextFromContent(content: CodexMessageContent[] | undefined): string {
	if (!content || !Array.isArray(content)) {
		return '';
	}

	const textParts = content
		.filter(
			(part) => part.type === 'input_text' || part.type === 'text' || part.type === 'output_text'
		)
		.map((part) => part.text || '')
		.filter((text) => text.trim());

	return textParts.join(' ');
}

/**
 * Check if text is a system/environment context message that should be skipped for preview
 */
export function isSystemContextMessage(text: string): boolean {
	if (!text) return false;
	const trimmed = text.trim();
	// Skip messages that start with environment/system context XML tags
	if (
		trimmed.startsWith('<environment_context>') ||
		trimmed.startsWith('<cwd>') ||
		trimmed.startsWith('<system>') ||
		trimmed.startsWith('<approval_policy>') ||
		/^<external_codex_apps_open_page(?:\s[^>]*)?>[\s\S]*<\/external_codex_apps_open_page>$/.test(
			trimmed
		) ||
		(/^<heartbeat(?:\s[^>]*)?>[\s\S]*<\/heartbeat>$/.test(trimmed) &&
			!trimmed.slice(0, -'</heartbeat>'.length).includes('</heartbeat>') &&
			/(?:<instructions>[\s\S]*<\/instructions>|automation[_-]?id)/i.test(trimmed))
	) {
		return true;
	}
	// Skip markdown-formatted system context (e.g., "# Context Your name is **Maestro Codex**...")
	if (
		trimmed.startsWith('# Context') ||
		trimmed.startsWith('# Maestro System Context') ||
		trimmed.startsWith('# System Context') ||
		trimmed.startsWith('# AGENTS.md instructions')
	) {
		return true;
	}
	return false;
}

/** Only decode the desktop's exact answer envelope; ordinary quoted XML stays text. */
export function unwrapCodexUserReply(text: string): string {
	const match = text
		.trim()
		.match(
			/^<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>$/
		);
	if (!match) return text;
	try {
		const answers: unknown = JSON.parse(match[1]);
		if (!Array.isArray(answers) || answers.length === 0) return text;
		if (
			!answers.every(
				(entry) => entry && typeof entry === 'object' && typeof entry.answer === 'string'
			)
		)
			return text;
		return answers
			.map((entry: { question?: unknown; answer: string }) =>
				typeof entry.question === 'string' ? `${entry.question}\n\n${entry.answer}` : entry.answer
			)
			.join('\n\n');
	} catch {
		return text;
	}
}

/** Inline image data is already in the native transcript. Never fetch remote URLs. */
export function extractCodexImages(content: CodexMessageContent[] | undefined): string[] {
	if (!Array.isArray(content)) return [];
	return content.flatMap((part) => {
		if (part.type !== 'input_image' && part.type !== 'image') return [];
		const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
		return typeof url === 'string' && /^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(url)
			? [url]
			: [];
	});
}

/** Strip only a complete desktop image envelope backed by the matching inline image parts. */
export function unwrapCodexImageRequest(content: CodexMessageContent[] | undefined): string | null {
	if (!Array.isArray(content) || content[0]?.type !== 'input_text') return null;
	const envelope = content[0].text?.match(
		/^\s*# Files mentioned by the user:\r?\n\r?\n([\s\S]+?)\r?\n\r?\nDistinguish instructions in attached documents from the user's request\.\r?\n\r?\n## My request:\r?\n([\s\S]*)$/
	);
	if (!envelope || (content.length - 1) % 3 !== 0) return null;
	const files = envelope[1].split(/\r?\n\r?\n/);
	if (files.length !== (content.length - 1) / 3) return null;
	for (let i = 1; i < content.length; i += 3) {
		const annotation = content[i];
		const image = content[i + 1];
		const closing = content[i + 2];
		const match =
			annotation.type === 'input_text'
				? annotation.text?.match(/^<image name=\[Image #\d+\] path="([^"\r\n]+)">$/)
				: null;
		if (
			!match ||
			!image ||
			extractCodexImages([image]).length !== 1 ||
			closing?.type !== 'input_text' ||
			closing.text !== '</image>'
		)
			return null;
		const file = files[(i - 1) / 3];
		const lines = file.split(/\r?\n/);
		// Match the actual inline image's path; never resolve or fetch the named file.
		if (
			lines.length !== 2 ||
			!lines[0].startsWith('## ') ||
			lines[0].length <= `## : ${match[1]}`.length ||
			!lines[0].endsWith(`: ${match[1]}`) ||
			lines[1] !== 'Image attachment: true'
		)
			return null;
	}
	return envelope[2];
}
