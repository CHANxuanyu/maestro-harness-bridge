import { describe, expect, it } from 'vitest';
import { execFileStreaming } from '../../../main/utils/execFile';

describe('bounded execFileStreaming options', () => {
	it('retains full output by default', async () => {
		const handle = execFileStreaming(
			process.execPath,
			['-e', 'process.stdout.write("complete output")'],
			{ onChunk: () => {} }
		);
		expect(await handle.result).toEqual({ stdout: 'complete output', stderr: '', exitCode: 0 });
	});

	it('bounds captured tails while delivering every chunk to the consumer', async () => {
		let bytes = 0;
		const handle = execFileStreaming(
			process.execPath,
			['-e', 'process.stdout.write("x".repeat(100000)+"tail");process.stderr.write("error tail")'],
			{
				maxCaptureChars: 4,
				onChunk: (chunk) => {
					bytes += chunk.length;
				},
			}
		);
		expect(await handle.result).toEqual({ stdout: 'tail', stderr: 'tail', exitCode: 0 });
		expect(bytes).toBe(100014);
	});

	it('supports stdin payloads with capture disabled', async () => {
		let output = '';
		const handle = execFileStreaming(
			process.execPath,
			['-e', 'process.stdin.pipe(process.stdout)'],
			{
				input: 'stdin payload',
				maxCaptureChars: 0,
				onChunk: (chunk) => {
					output += chunk;
				},
			}
		);
		expect(await handle.result).toEqual({ stdout: '', stderr: '', exitCode: 0 });
		expect(output).toBe('stdin payload');
	});
});
