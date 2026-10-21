import { useCallback, useEffect, useState } from 'react';
import type { MaestroCliStatus } from '../../../../../../shared/maestro-cli';
import { captureException } from '../../../../../utils/sentry';
import type { MaestroCliState } from '../types';
import { useT, type MessageKey } from '../../../../../i18n';

interface UseMaestroCliStateArgs {
	isOpen: boolean;
}

export function useMaestroCliState({ isOpen }: UseMaestroCliStateArgs): MaestroCliState {
	const [status, setStatus] = useState<MaestroCliStatus | null>(null);
	const t = useT();
	const [statusError, setStatusError] = useState<{ key: MessageKey } | { text: string } | null>(
		null
	);
	const [checking, setChecking] = useState(false);
	const [installing, setInstalling] = useState(false);
	const [installMessage, setInstallMessage] = useState<{ key: MessageKey; ok: boolean } | null>(
		null
	);

	const checkStatus = useCallback(async () => {
		setChecking(true);
		setStatusError(null);
		// Clear the previous result up front: leaving the last-known status in
		// place while a re-check is in flight means a check that then FAILS
		// still shows the prior "Installed" badge instead of reading as unknown.
		setStatus(null);
		try {
			const nextStatus = await window.maestro.maestroCli.checkStatus();
			setStatus(nextStatus);
		} catch (err) {
			setStatusError({ key: 'settings.general.cli.checkFailed' });
			captureException(err instanceof Error ? err : new Error(String(err)), {
				extra: { context: 'GeneralTab: Maestro CLI status check' },
			});
		} finally {
			setChecking(false);
		}
	}, []);

	const installOrUpdate = useCallback(async () => {
		setInstalling(true);
		setInstallMessage(null);
		setStatusError(null);
		try {
			const result = await window.maestro.maestroCli.installOrUpdate();
			setStatus(result.status);
			if (result.pathUpdateError) {
				setStatusError({ text: result.pathUpdateError });
			}
			if (result.restartRequired) {
				setInstallMessage({ key: 'settings.general.cli.installedRestart', ok: true });
			} else if (result.success && result.status.versionMatch) {
				setInstallMessage({ key: 'settings.general.cli.installedOk', ok: true });
			} else {
				setInstallMessage({ key: 'settings.general.cli.installedAttention', ok: false });
			}
		} catch (err) {
			setStatusError({ key: 'settings.general.cli.installFailed' });
			captureException(err instanceof Error ? err : new Error(String(err)), {
				extra: { context: 'GeneralTab: Maestro CLI install/update' },
			});
		} finally {
			setInstalling(false);
		}
	}, []);

	useEffect(() => {
		if (!isOpen) return;
		setInstallMessage(null);
		void checkStatus();
	}, [checkStatus, isOpen]);

	return {
		status,
		statusError: statusError && ('key' in statusError ? t(statusError.key) : statusError.text),
		checking,
		installing,
		installMessage: installMessage && { text: t(installMessage.key), ok: installMessage.ok },
		checkStatus,
		installOrUpdate,
	};
}
