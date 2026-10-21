import { useT, type TFunction } from '../../../i18n';
/**
 * MentionRoutingBar - shows, BEFORE send, how a message's `@agent` mentions
 * will run.
 *
 * The order is read from the user's own words (`inferMentionTiming`): "check
 * with @Backend first" consults before this agent answers, "then send what you
 * find to @Backend" hands this agent's answer over afterwards, and anything
 * else runs both at once. A guess the user cannot see is a guess they cannot
 * correct, so the strip states it plainly and says how to change it: reword
 * the message. There is deliberately no toggle - the wording IS the control,
 * which keeps a typed message, a queued edit, and `maestro-cli dispatch` all
 * routing the same way.
 *
 * AI mode only, and only while the draft mentions another agent.
 */

import { memo } from 'react';
import { ArrowLeftToLine, ArrowRightFromLine, AtSign, Split } from 'lucide-react';
import type { Theme } from '../../../types';
import type { MentionRouting } from '../../../../shared/crossAgentContext';
import { formatConsultedAgentNames } from '../../../services/crossAgentConsultHold';

interface MentionRoutingBarProps {
	theme: Theme;
	routing: MentionRouting;
	/** Display names of the mentioned agents, in message order. */
	agentNames: string[];
}

function getRoutingCopy(t: TFunction): Record<
	MentionRouting,
	{
		label: string;
		Icon: typeof Split;
		/** `many`: more than one agent is mentioned, so the verb is plural. */
		describe: (names: string, many: boolean) => string;
		hint: string;
	}
> {
	return {
		only: {
			label: t('workflows.shell.only'),
			Icon: AtSign,
			describe: (names, many) =>
				t(many ? 'workflows.mention.onlyMany' : 'workflows.mention.onlyOne', { names }),
			hint: t('workflows.mention.onlyHint'),
		},
		parallel: {
			label: t('workflows.shell.parallel'),
			Icon: Split,
			describe: (names, many) =>
				t(many ? 'workflows.mention.parallelMany' : 'workflows.mention.parallelOne', { names }),
			hint: t('workflows.mention.parallelHint'),
		},
		'consult-first': {
			label: t('workflows.shell.consultFirst'),
			Icon: ArrowLeftToLine,
			describe: (names, many) =>
				t(many ? 'workflows.mention.firstMany' : 'workflows.mention.firstOne', { names }),
			hint: t('workflows.mention.firstHint'),
		},
		handoff: {
			label: t('workflows.shell.handOff'),
			Icon: ArrowRightFromLine,
			describe: (names) => t('workflows.mention.handoff', { names }),
			hint: t('workflows.mention.handoffHint'),
		},
	};
}

export const MentionRoutingBar = memo(function MentionRoutingBar({
	theme,
	routing,
	agentNames,
}: MentionRoutingBarProps) {
	const t = useT();
	const copy = getRoutingCopy(t)[routing];
	const { Icon } = copy;
	return (
		<div
			className="flex items-center gap-2 px-3 py-1 border-b text-2xs select-none"
			style={{
				borderColor: `${theme.colors.accent}30`,
				backgroundColor: `color-mix(in srgb, ${theme.colors.accent} 10%, transparent)`,
			}}
			data-testid="mention-routing-bar"
			data-routing={routing}
		>
			<Icon className="w-3 h-3 shrink-0" style={{ color: theme.colors.accent }} />
			<span
				className="font-medium uppercase tracking-wide shrink-0"
				style={{ color: theme.colors.accent }}
			>
				{copy.label}
			</span>
			<span className="truncate" style={{ color: theme.colors.textDim }}>
				{copy.describe(
					formatConsultedAgentNames(agentNames.map((n) => `@${n}`)),
					agentNames.length > 1
				)}
			</span>
			<span
				className="ml-auto shrink-0 hidden sm:inline cursor-help underline decoration-dotted"
				style={{ color: theme.colors.textDim }}
				title={copy.hint}
			>
				{t('workflows.shell.rewordToChange')}
			</span>
		</div>
	);
});
