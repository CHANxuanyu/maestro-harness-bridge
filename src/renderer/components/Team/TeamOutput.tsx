import { useEffect, useMemo, useState } from 'react';
import type { TeamState } from '../../../shared/team/types';
import { getFileExtension } from '../../../shared/fileCategories';
import { isImageFile } from '../../../shared/gitUtils';
import { shouldOpenExternally } from '../../utils/fileExplorer';
import { isAbsolutePath, joinPath } from '../../../shared/formatters';
import type { Theme } from '../../types';
import { useT } from '../../i18n';
import { SegmentedControl } from '../ui/SegmentedControl';
import { MarkdownImage } from '../FilePreview/MarkdownImage';
import { Markdown, type MarkdownProps } from '../Markdown/Markdown';
import { generateProseStyles } from '../../utils/markdownConfig';
import { TeamFold, teamPathLabel } from './TeamPrimitives';

function OutputFile({
	path,
	label,
	theme,
	sshRemoteId,
}: {
	path: string;
	label: string;
	theme: Theme;
	sshRemoteId?: string;
}) {
	const t = useT();
	const [open, setOpen] = useState(false);
	const [content, setContent] = useState<string | null>(null);
	const [failed, setFailed] = useState(false);
	const extension = getFileExtension(path);
	const external = shouldOpenExternally(path);
	const proseStyles = useMemo(
		() => generateProseStyles({ theme, scopeSelector: '.team-output-document' }),
		[theme]
	);
	const imageRenderer = useMemo<MarkdownProps['imageRenderer']>(
		() => (props) => (
			<MarkdownImage {...props} markdownFilePath={path} theme={theme} sshRemoteId={sshRemoteId} />
		),
		[path, theme, sshRemoteId]
	);
	useEffect(() => {
		if (!open || external) return;
		let stale = false;
		setFailed(false);
		void window.maestro.fs.readFile(path, sshRemoteId).then(
			(text) => {
				if (!stale) {
					setContent(text);
					setFailed(text === null);
				}
			},
			() => {
				if (!stale) setFailed(true);
			}
		);
		return () => {
			stale = true;
		};
	}, [open, path, sshRemoteId, external]);
	return (
		<div>
			<button
				type="button"
				className="underline break-all text-left"
				aria-expanded={open}
				disabled={external && !!sshRemoteId}
				onClick={() => {
					if (external) void window.maestro.shell.openPath(path);
					else setOpen(!open);
				}}
			>
				{t('workflows.team.openFile', { path: label })}
			</button>
			{open && (
				<div
					className="mt-2 max-h-96 overflow-auto rounded border p-3"
					style={{ borderColor: 'var(--team-border)' }}
				>
					{failed ? (
						<p role="alert">{t('workflows.sessions.loadMessagesFailed')}</p>
					) : content === null ? (
						<p>{t('workflows.team.loading')}</p>
					) : isImageFile(path) ? (
						<img src={content} alt={label} />
					) : ['md', 'mdx', 'markdown'].includes(extension) ? (
						<div className="team-output-document">
							<style>{proseStyles}</style>
							<div className="prose prose-sm max-w-none">
								<Markdown
									theme={theme}
									content={content}
									preset="document"
									sshRemoteId={sshRemoteId}
									imageRenderer={imageRenderer}
								/>
							</div>
						</div>
					) : (
						<pre className="whitespace-pre-wrap break-words">{content}</pre>
					)}
				</div>
			)}
		</div>
	);
}

export function TeamOutput({
	state,
	theme,
	disclosure = true,
}: {
	state: TeamState;
	theme: Theme;
	disclosure?: boolean;
}) {
	const t = useT();
	const [version, setVersion] = useState<'now' | 'before'>('now');
	const latest = state.outputs.at(-1);
	const before = state.outputs.find((output) => output.outputId === latest?.beforeOutputId);
	const output = version === 'before' && before ? before : latest;
	if (!output) return <p className="team-dim">{t('workflows.team.noOutput')}</p>;
	const cwd = state.seats.dev.binding?.workspace ?? state.config!.projectRoot;
	const files = output.files.map((file) => (
		<OutputFile
			key={`${output.id}:${file}`}
			path={isAbsolutePath(file) ? file : joinPath(cwd, file)}
			label={teamPathLabel(
				output.locations?.find((location) => location.file === file)?.location.target ?? file,
				state
			)}
			theme={theme}
			sshRemoteId={state.config?.sshRemoteId}
		/>
	));
	return (
		<div className="space-y-3" data-testid="team-output">
			{before && before !== latest && (
				<SegmentedControl
					theme={theme}
					value={version}
					onChange={setVersion}
					ariaLabel={t('workflows.team.beforeAfter')}
					options={[
						{ value: 'now', label: t('workflows.team.now') },
						{ value: 'before', label: t('workflows.team.before') },
					]}
				/>
			)}
			{output.previews.map((preview) => (
				<MarkdownImage
					key={preview}
					src={preview}
					alt={t('workflows.team.preview')}
					markdownFilePath={joinPath(cwd, 'team-output.md')}
					theme={theme}
					sshRemoteId={state.config?.sshRemoteId}
				/>
			))}
			{disclosure ? (
				<TeamFold title={t('workflows.team.output')}>{files}</TeamFold>
			) : (
				<div className="space-y-3">{files}</div>
			)}
			<p className="team-dim">{t('workflows.team.outputSource')}</p>
		</div>
	);
}
