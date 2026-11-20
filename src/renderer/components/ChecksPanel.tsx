import { useEffect, useState } from 'react';
import {
	conversationKey,
	type AutomationAction,
	type ConversationTarget,
} from '../../shared/conversationAutomation';
import { useConversationAutomationStore } from '../stores/conversationAutomationStore';
import { useT } from '../i18n';
import { ConversationAutomationCards } from './ConversationAutomationCards';

export function ChecksPanel({ target }: { target: ConversationTarget }) {
	const t = useT();
	const state = useConversationAutomationStore((s) => s.states[conversationKey(target)]);
	const [commands, setCommands] = useState('');
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);
	const savedCommands = state?.checks.map((check) => check.command).join('\n') ?? '';
	useEffect(() => {
		setCommands(savedCommands);
	}, [savedCommands, target.sessionId, target.tabId]);
	const act = async (action: AutomationAction) => {
		await window.maestro.conversationAutomation.execute({ target, ...action });
	};
	const send = (action: AutomationAction) => {
		setBusy(true);
		setError('');
		void act(action)
			.catch((error: unknown) => setError(String(error)))
			.finally(() => setBusy(false));
	};
	const batch = state?.batches.at(-1);
	return (
		<div className="p-4 space-y-3 overflow-y-auto text-sm" data-testid="checks-panel">
			<label className="block">
				{t('workflows.automation.commands')}
				<textarea
					aria-label={t('workflows.automation.commands')}
					className="block w-full min-h-24 mt-2 rounded border border-current/25 bg-transparent p-2 font-mono text-xs"
					value={commands}
					onChange={(event) => setCommands(event.target.value)}
				/>
			</label>
			<div className="flex flex-wrap gap-2">
				<button
					type="button"
					className="rounded border border-current/25 px-2 py-1 disabled:opacity-50"
					disabled={busy || state?.running}
					onClick={() =>
						send({
							action: 'checks-set',
							commands: commands.split('\n').filter((line) => line.trim()),
						})
					}
				>
					{t('workflows.automation.saveChecks')}
				</button>
				<button
					type="button"
					className="rounded border border-current/25 px-2 py-1 disabled:opacity-50"
					disabled={busy || state?.running}
					onClick={() => send({ action: 'checks-run' })}
				>
					{t('workflows.automation.runChecks')}
				</button>
			</div>
			{error && <p role="alert">{error}</p>}
			{state?.running && <p>{t('workflows.automation.running')}</p>}
			{batch && (
				<>
					<p>
						{t('workflows.automation.passed', {
							passed: batch.checks.filter((check) => check.outcome === 'pass').length,
							total: batch.checks.length,
						})}
					</p>
					{batch.checks.map((check) => (
						<section key={check.id} className="rounded border border-current/25 p-3 select-text">
							<code>{check.command}</code>
							<p>
								{t(
									`workflows.automation.${check.outcome === 'pass' || check.outcome === 'fail' ? check.outcome : 'not-run'}`
								)}
								{check.outcome !== 'pass' && check.exitCode !== null && (
									<> · {t('workflows.activity.exitCode', { code: check.exitCode })}</>
								)}
							</p>
							<pre className="whitespace-pre-wrap break-all text-xs">
								{check.error || check.outputTail}
							</pre>
						</section>
					))}
				</>
			)}
			{state && <ConversationAutomationCards state={state} act={act} surface="panel" />}
			{state?.fix === 'manual' && batch?.checks.some((check) => check.outcome === 'fail') && (
				<button
					type="button"
					className="rounded border border-current/25 px-2 py-1 disabled:opacity-50"
					onClick={() => send({ action: 'fix', mode: 'auto' })}
				>
					{t('workflows.automation.fixAuto')}
				</button>
			)}
		</div>
	);
}
