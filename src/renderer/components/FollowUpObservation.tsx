import type { FollowUpExternalStatus } from '../../shared/followUp';
import { useT } from '../i18n';

/** Render observed facts as labelled values, never the transport JSON. */
export function FollowUpObservation({ status }: { status: FollowUpExternalStatus }) {
	const t = useT();
	const waiting =
		['queued', 'waiting', 'pending', 'requested'].includes(status.status ?? '') ||
		status.state === 'waiting';
	return (
		<div className="space-y-1 select-text">
			<p>
				{t(
					waiting
						? 'workflows.automation.waiting'
						: status.state === 'completed'
							? 'workflows.automation.observationCompleted'
							: status.state === 'unavailable'
								? 'workflows.automation.observationUnavailable'
								: 'workflows.automation.observationRunning'
				)}
			</p>
			{status.exitCode != null && (
				<p>{t('workflows.automation.observationExit', { code: status.exitCode })}</p>
			)}
			{status.conclusion && (
				<p>
					{t('workflows.automation.observationConclusion', {
						conclusion:
							status.conclusion === 'success'
								? t('workflows.automation.pass')
								: status.conclusion === 'failure'
									? t('workflows.automation.fail')
									: status.conclusion,
					})}
				</p>
			)}
			{status.failingJob && (
				<p>{t('workflows.automation.observationJob', { job: status.failingJob })}</p>
			)}
			{status.error && <p>{status.error}</p>}
			{status.outputTail && (
				<pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words">
					{status.outputTail}
				</pre>
			)}
		</div>
	);
}
