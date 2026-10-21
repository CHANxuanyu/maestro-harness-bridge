import { useT } from '../../i18n';
import React from 'react';
import type { NudgeMessageFieldProps } from './types';
import { NUDGE_MESSAGE_MAX_LENGTH } from './types';
import { useResizableTextarea } from '../../hooks/ui/useResizableTextarea';

export const NudgeMessageField = React.memo(function NudgeMessageField({
	theme,
	value,
	onChange,
	maxLength = NUDGE_MESSAGE_MAX_LENGTH,
	label,
	labelSuffix,
	description,
	placeholder,
	sizeKey = 'nudge-message',
}: NudgeMessageFieldProps) {
	const uiText = useT();
	const resize = useResizableTextarea({ sizeKey, minHeight: 80 });

	return (
		<div>
			<div
				className="block text-xs font-bold opacity-70 uppercase mb-2"
				style={{ color: theme.colors.textMain }}
			>
				{label ?? uiText('workflows.sessions.nudgeMessage')}{' '}
				<span className="font-normal opacity-50">
					{labelSuffix ?? uiText('workflows.sessions.optional')}
				</span>
			</div>
			<p className="text-xs opacity-50 mb-2">
				{description ?? (
					<>
						{uiText('workflows.sessions.nudgePrefix')}{' '}
						<strong>
							<u>{uiText('workflows.sessions.everyMessage')}</u>
						</strong>{' '}
						{uiText('workflows.sessions.nudgeSuffix')}
					</>
				)}
			</p>
			<textarea
				ref={resize.textareaRef}
				value={value}
				onChange={(e) => onChange(e.target.value.slice(0, maxLength))}
				placeholder={placeholder ?? uiText('workflows.sessions.nudgePlaceholder')}
				className="w-full p-3 rounded border bg-transparent outline-none resize-y text-sm"
				style={{
					borderColor: theme.colors.border,
					color: theme.colors.textMain,
					minHeight: '80px',
					...resize.style,
				}}
				maxLength={maxLength}
			/>
			<div
				className="text-xs mt-1 text-right"
				style={{
					color: value.length > maxLength * 0.9 ? theme.colors.warning : theme.colors.textDim,
				}}
			>
				{value.length}/{maxLength}
			</div>
		</div>
	);
});
