import { useEffect, useRef, useState } from 'react';
import type {
	NativeToolOutputResult,
	NativeToolOutputTarget,
} from '../../../../shared/nativeToolOutput';
import { useT } from '../../../i18n';
import { safeClipboardWrite } from '../../../utils/clipboard';
import type { Theme } from '../../../types';

/** Mounted only in an expanded new-shell card. No session/store writes. */
export function NativeToolOutput({
	target,
	toolCallId,
	originalChars,
	theme,
}: {
	target: NativeToolOutputTarget;
	toolCallId: string;
	originalChars: number;
	theme: Theme;
}) {
	const t = useT();
	const [result, setResult] = useState<NativeToolOutputResult | null>(null);
	const [loading, setLoading] = useState(false);
	const [copied, setCopied] = useState<boolean | null>(null);
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const read = async () => {
		setLoading(true);
		try {
			const value = await window.maestro.agentSessions.toolOutput(target, toolCallId);
			if (mounted.current) setResult(value);
		} catch {
			if (mounted.current) setResult({ status: 'unavailable' });
		} finally {
			if (mounted.current) setLoading(false);
		}
	};
	return (
		<div className="text-xs" style={{ color: theme.colors.textDim }}>
			{!result && !loading && (
				<button type="button" className="underline" onClick={read}>
					{t('workflows.transcript.fullToolOutput', { size: Math.ceil(originalChars / 1024) })}
				</button>
			)}
			{loading && <div role="status">{t('workflows.transcript.fullToolOutputLoading')}</div>}
			{result && result.status !== 'found' && (
				<div role="status">
					{t(
						result.status === 'not-found'
							? 'workflows.transcript.fullToolOutputMissing'
							: result.status === 'too-large'
								? 'workflows.transcript.fullToolOutputTooLarge'
								: 'workflows.transcript.fullToolOutputUnavailable'
					)}
				</div>
			)}
			{result?.status === 'found' && (
				<>
					<div className="flex items-center gap-3 mb-1">
						<button
							type="button"
							className="underline"
							onClick={async () => {
								const ok = await safeClipboardWrite(result.text);
								if (mounted.current) setCopied(ok);
							}}
						>
							{t('workflows.transcript.fullToolOutputCopy')}
						</button>
						<button
							type="button"
							className="underline"
							onClick={() => {
								setResult(null);
								setCopied(null);
							}}
						>
							{t('workflows.transcript.fullToolOutputHide')}
						</button>
						{copied !== null && (
							<span role="status">
								{t(
									copied
										? 'workflows.transcript.fullToolOutputCopied'
										: 'workflows.transcript.fullToolOutputCopyFailed'
								)}
							</span>
						)}
					</div>
					{result.omittedBytes > 0 && (
						<div>
							{t('workflows.transcript.fullToolOutputOmitted', { bytes: result.omittedBytes })}
						</div>
					)}
					<pre
						data-testid="native-tool-output"
						tabIndex={0}
						className="m-0 p-2 overflow-auto scrollbar-thin whitespace-pre-wrap break-words font-mono rounded select-text"
						style={{
							maxHeight: '20rem',
							overscrollBehavior: 'contain',
							color: theme.colors.textMain,
							backgroundColor: theme.colors.bgSidebar,
						}}
					>
						{result.text}
					</pre>
				</>
			)}
		</div>
	);
}
