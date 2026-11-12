import React, { memo, useEffect, useRef, useState } from 'react';
import type { Theme } from '../types';
import type { NativeProject } from '../../shared/projects';
import { getBasename, truncatePath } from '../../shared/formatters';
import { readableTextOn } from '../../shared/colorContrast';
import { MODAL_PRIORITIES } from '../constants/modalPriorities';
import { Modal, MODAL_BUTTON_BASE_CLASS, MODAL_BUTTON_SECONDARY_CLASS } from './ui/Modal';
import { FormInput } from './ui/FormInput';
import { openProject } from '../services/openProject';
import { useT } from '../i18n';
import { captureException } from '../utils/sentry';
import { useOpenProjectPathStore } from '../stores/openProjectPathStore';

export const OpenProjectPathHost = memo(function OpenProjectPathHost({ theme }: { theme: Theme }) {
	const open = useOpenProjectPathStore((s) => s.open);
	if (!open) return null;
	return (
		<OpenProjectPathModal
			theme={theme}
			onClose={() => useOpenProjectPathStore.getState().setOpen(false)}
		/>
	);
});

function OpenProjectPathModal({ theme, onClose }: { theme: Theme; onClose: () => void }) {
	const t = useT();
	const inputRef = useRef<HTMLInputElement>(null);
	const [value, setValue] = useState('');
	const [projects, setProjects] = useState<NativeProject[]>([]);
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		let active = true;
		void window.maestro.agentSessions
			.projects()
			.then((items) => {
				if (active) setProjects(items.slice(0, 8));
			})
			.catch((error) => captureException(error));
		return () => {
			active = false;
		};
	}, []);
	const submit = async (path: string) => {
		const trimmed = path.trim();
		if (!trimmed || busy) return;
		setBusy(true);
		const result = await openProject(trimmed);
		setBusy(false);
		// A failure already raised its own notice; keep the prompt so the path can be fixed.
		if (result.success) onClose();
	};
	const dim = readableTextOn(theme.colors.textDim, [theme.colors.bgSidebar]);
	return (
		<Modal
			theme={theme}
			title={t('workflows.projects.pathTitle')}
			priority={MODAL_PRIORITIES.OPEN_PROJECT_PATH}
			onClose={onClose}
			width={440}
			initialFocusRef={inputRef as React.RefObject<HTMLElement>}
			footer={
				<>
					<button
						type="button"
						onClick={onClose}
						className={MODAL_BUTTON_SECONDARY_CLASS}
						style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
					>
						{t('common.cancel')}
					</button>
					<button
						type="button"
						disabled={!value.trim() || busy}
						onClick={() => void submit(value)}
						className={MODAL_BUTTON_BASE_CLASS}
						style={{
							backgroundColor: theme.colors.accent,
							color: theme.colors.accentForeground,
							opacity: !value.trim() || busy ? 0.6 : 1,
						}}
					>
						{t('workflows.projects.pathOpen')}
					</button>
				</>
			}
		>
			<p className="text-sm mb-3" style={{ color: dim }}>
				{t('workflows.projects.pathHint')}
			</p>
			<FormInput
				ref={inputRef}
				theme={theme}
				value={value}
				onChange={setValue}
				onSubmit={() => void submit(value)}
				placeholder={t('workflows.projects.pathPlaceholder')}
				testId="open-project-path"
			/>
			{projects.length > 0 && (
				<section className="mt-4">
					<h3 className="text-xs mb-1" style={{ color: dim }}>
						{t('workflows.projects.recent')}
					</h3>
					<ul>
						{projects.map((project) => (
							<li key={project.path}>
								<button
									type="button"
									onClick={() => void submit(project.path)}
									className="w-full text-left py-2.5 px-2 rounded hover:bg-white/5 focus-ring"
									title={project.path}
								>
									<span className="block truncate text-sm">{getBasename(project.path)}</span>
									<span className="block truncate text-xs mt-0.5" style={{ color: dim }}>
										{truncatePath(project.path, 48)}
									</span>
								</button>
							</li>
						))}
					</ul>
				</section>
			)}
		</Modal>
	);
}
