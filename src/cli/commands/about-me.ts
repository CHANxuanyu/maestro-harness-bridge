import fs from 'node:fs';
import path from 'node:path';
import { sendSimpleCommand, reportResult, failCommand } from '../services/session-command';
import type { AboutMeCommand, AboutMeResult, AboutMeConfirmation } from '../../shared/aboutMe';

interface AboutMeOptions {
	file?: string;
	stdin?: boolean;
	clear?: boolean;
	confirm?: string[];
	json?: boolean;
}

/** The desktop owns native-file writes, consent snapshots and settings updates. */
export async function aboutMe(action: string, options: AboutMeOptions): Promise<void> {
	const inputs =
		Number(options.file !== undefined) +
		Number(options.stdin === true) +
		Number(options.clear === true);
	if (
		!['show', 'set', 'status', 'apply'].includes(action) ||
		(action === 'set' ? inputs !== 1 : inputs !== 0) ||
		(action !== 'apply' && (options.confirm?.length ?? 0) > 0)
	) {
		return failCommand(
			'Use show, status, apply, or set with exactly one of --file, --stdin, --clear; --confirm belongs to apply',
			options.json
		);
	}
	const send = (command: AboutMeCommand) =>
		sendSimpleCommand<AboutMeResult>({ type: 'about_me', request: command }, 'about_me_result');
	const present = (result: AboutMeResult) => {
		if (options.json)
			return reportResult(
				{ ...result },
				{ json: true, successMessage: '', jsonResult: { ...result } }
			);
		if (action === 'show' && result.success) console.log(result.content);
		else {
			if (result.estimatedTokens !== undefined)
				console.log(`Estimated tokens: ${result.estimatedTokens}`);
			for (const file of result.files ?? []) {
				console.log(
					`${file.state}\t${file.path}${file.resolvedPath && file.resolvedPath !== file.path ? ` -> ${file.resolvedPath}` : ''}`
				);
				if (file.shadowedBy.length) console.log(`Shadowed by: ${file.shadowedBy.join(', ')}`);
				if (file.error) console.error(file.error);
			}
		}
		if (!result.success) return failCommand(result.error ?? 'About Me command failed');
	};
	try {
		if (action === 'set') {
			const content = options.clear
				? ''
				: fs.readFileSync(options.stdin ? 0 : options.file!, 'utf8');
			return present(await send({ action: 'set', content }));
		}
		if (action === 'apply') {
			const status = await send({ action: 'status' });
			if (!status.success) return present(status);
			const confirmations: AboutMeConfirmation[] = [];
			for (const approvedPath of options.confirm ?? []) {
				const file = path.isAbsolute(approvedPath)
					? status.files.find((entry) => entry.resolvedPath === approvedPath)
					: undefined;
				if (!file || file.currentBlock === undefined)
					return failCommand(
						'Use an exact resolved file path from about-me status for --confirm',
						options.json
					);
				confirmations.push({
					path: file.path,
					resolvedPath: file.resolvedPath!,
					block: file.currentBlock,
				});
			}
			return present(await send({ action: 'apply', content: status.content, confirmations }));
		}
		return present(await send({ action: action as 'show' | 'status' }));
	} catch (error) {
		return failCommand(error instanceof Error ? error.message : String(error), options.json);
	}
}
