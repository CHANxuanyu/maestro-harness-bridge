import { type SeatRole, type TeamReport, type TurnKind } from './types';

/** The JSON Schema subset used by team reports, shared by prompts and validation. */
export type ReportSchema =
	| {
			type: 'string';
			minLength?: number;
			pattern?: string;
			enum?: readonly string[];
			const?: string;
	  }
	| { type: 'boolean' }
	| { type: 'number'; minimum?: number }
	| { type: 'integer' }
	| { type: 'null' }
	| { type: 'array'; items: ReportSchema; minItems?: number }
	| {
			type: 'object';
			properties: Record<string, ReportSchema>;
			required: string[];
			additionalProperties: false;
	  }
	| { anyOf: ReportSchema[] };

const text: ReportSchema = { type: 'string', minLength: 1, pattern: '\\S' };
const number: ReportSchema = { type: 'number', minimum: 0 };
const boolean: ReportSchema = { type: 'boolean' };
const strings = (minItems = 0): ReportSchema => ({ type: 'array', items: text, minItems });
const array = (items: ReportSchema, minItems = 0): ReportSchema => ({
	type: 'array',
	items,
	minItems,
});
const choice = (...values: string[]): ReportSchema => ({ type: 'string', enum: values });
const object = (
	properties: Record<string, ReportSchema>,
	optional: string[] = []
): ReportSchema => ({
	type: 'object',
	properties,
	required: Object.keys(properties).filter((key) => !optional.includes(key)),
	additionalProperties: false,
});
const nullable = (schema: ReportSchema): ReportSchema => ({ anyOf: [schema, { type: 'null' }] });
const followUpCondition: ReportSchema = {
	anyOf: [
		object({ kind: choice('time'), at: number }),
		object({ kind: choice('command'), processId: text }),
		object({
			kind: choice('ci'),
			runId: { type: 'string', pattern: '^\\d+$' },
			cwd: text,
		}),
	],
};
const location = object({
	label: text,
	target: text,
	kind: choice('file', 'preview', 'screenshot'),
});
const criterion = object(
	{
		id: text,
		text,
		proof: choice('app', 'qa', 'pm'),
		how: text,
		experience: boolean,
		locations: array(location),
	},
	['experience', 'locations']
);
const topicProperties = {
	topic: text,
	why: text,
	participants: array(choice('pm', 'dev', 'qa'), 1),
	owner: choice('pm', 'dev', 'qa'),
	layer: choice('fact', 'implementation', 'testing', 'product', 'commitment'),
	reversible: boolean,
	question: text,
	kind: choice('discussion', 'standard'),
	criterionId: text,
	reopens: text,
	evidence: strings(),
};
const topicOptional = [
	'owner',
	'layer',
	'reversible',
	'question',
	'kind',
	'criterionId',
	'reopens',
	'evidence',
];
const change = object(
	{
		criterionId: text,
		change: choice('add', 'tighten', 'relax', 'modify', 'remove'),
		criterion,
		reason: text,
		withinMeaning: text,
		extraTurns: number,
		preservesDeadline: boolean,
		ownerMessageId: text,
	},
	['criterion', 'withinMeaning', 'extraTurns', 'preservesDeadline', 'ownerMessageId']
);
const report = (
	type: TeamReport['type'],
	properties: Record<string, ReportSchema>,
	optional: string[] = []
): ReportSchema =>
	object(
		{
			type: { type: 'string', const: type },
			topic: object(topicProperties, topicOptional),
			standardChanges: array(change),
			requestedActions: array(
				object({
					action: choice('push', 'draftPr', 'merge', 'publish', 'externalMessage'),
					detail: text,
				})
			),
			...properties,
		},
		[...optional, ...(type === 'topic' ? [] : ['topic']), 'standardChanges', 'requestedActions']
	);

const briefProperties = {
	scope: text,
	notDoing: strings(),
	criteria: array(criterion, 1),
	checks: array(
		object(
			{
				command: text,
				expectExit: { type: 'integer' },
				covers: strings(1),
				boundary: choice('outside-workspace', 'external-write'),
			},
			['boundary', 'expectExit']
		)
	),
};
const issueProperties = {
	title: text,
	criterion: text,
	kind: choice('defect', 'standard'),
	steps: strings(1),
};
const challengeProperties = {
	objections: array(
		object({ about: text, problem: text, kind: choice('unreasonable', 'unverifiable', 'risk') })
	),
	plans: array(object({ criterion: text, how: text, data: text })),
};

/** Unknown properties are refused so a work report cannot smuggle in a verification verdict. */
export const REPORT_SCHEMAS: Record<TeamReport['type'], ReportSchema> = {
	recovery: report('recovery', { summary: text, recoveredJson: text }, ['recoveredJson']),
	wrap_up: report('wrap_up', { summary: text, priorities: strings(1) }),
	wait: report('wait', { summary: text, status: choice('waiting', 'ready', 'problem') }),
	brief: report('brief', briefProperties),
	challenge: report('challenge', challengeProperties, ['plans']),
	respond: report(
		'respond',
		{
			decisions: array(
				object({ about: text, result: choice('accept', 'reject', 'discuss'), reason: text })
			),
			brief: object(briefProperties),
			askOwner: nullable(text),
		},
		['askOwner']
	),
	work: report(
		'work',
		{
			done: strings(),
			summary: text,
			claimsComplete: boolean,
			waiting: nullable(
				object(
					{
						reason: text,
						waitFor: text,
						needs: array(choice('pm', 'dev', 'qa'), 1),
						condition: followUpCondition,
					},
					['needs', 'condition']
				)
			),
		},
		['waiting']
	),
	qa_prep: report('qa_prep', { tests: strings(), samples: strings() }),
	verify: report('verify', {
		criteria: array(object({ id: text, pass: boolean, evidence: text })),
		issues: array(
			object({ ...issueProperties, expected: text, actual: text }, [
				'criterion',
				'expected',
				'actual',
			])
		),
	}),
	fix: report(
		'fix',
		{
			fixed: strings(),
			notFixed: array(object({ id: text, why: text })),
			summary: text,
			attempt: object({ basis: text, difference: text, expectation: text }),
		},
		['summary', 'attempt']
	),
	reverify: report('reverify', {
		results: array(object({ issue: text, pass: boolean, evidence: text })),
		newIssues: array(object(issueProperties, ['criterion'])),
	}),
	// A missing/blank criterion is accepted only so it can be demoted to a suggestion.
	review: report('review', {
		verdict: choice('pass', 'reject'),
		problems: array(
			object(
				{
					title: text,
					location: text,
					criterion: { type: 'string' },
					impact: text,
					expected: text,
				},
				['criterion']
			)
		),
		suggestions: strings(),
	}),
	demo: report('demo', {
		summary: text,
		evidence: strings(),
		decisions: strings(),
		changes: strings(),
	}),
	topic: report('topic', topicProperties, topicOptional),
	position: report(
		'position',
		{
			discussionId: text,
			claim: text,
			basis: text,
			wouldChangeMind: text,
			evidence: strings(),
			extraTurns: number,
			preservesDeadline: boolean,
		},
		['evidence', 'extraTurns', 'preservesDeadline']
	),
	proposal: report(
		'proposal',
		{
			discussionId: text,
			proposal: text,
			decider: choice('app', 'owner', 'pm', 'dev', 'qa'),
			actions: array(
				object(
					{
						seat: choice('pm', 'dev', 'qa'),
						action: text,
						waitFor: text,
						condition: followUpCondition,
					},
					['waitFor', 'condition']
				),
				1
			),
			compromise: text,
			experiment: object(
				{
					command: text,
					basis: text,
					expected: text,
					expectExit: { type: 'integer' },
					boundary: choice('outside-workspace', 'external-write'),
				},
				['boundary', 'expectExit']
			),
			options: array(
				object({ id: text, label: text, cost: text, recommended: boolean }, [
					'cost',
					'recommended',
				]),
				2
			),
		},
		['compromise', 'experiment', 'options']
	),
	response: report(
		'response',
		{
			discussionId: text,
			result: choice('agree', 'reserve', 'insist'),
			reason: text,
			evidence: text,
			baselineViolation: text,
		},
		['evidence', 'baselineViolation']
	),
	retro: report('retro', {
		discussionId: text,
		causes: text,
		approach: text,
		basis: text,
		difference: text,
		progressEvidence: text,
	}),
	message: report(
		'message',
		{
			summary: text,
			messages: array(
				object(
					{
						messageId: text,
						scope: boolean,
						criterion,
						change: choice('add', 'modify', 'tighten', 'relax', 'remove'),
						criterionId: text,
					},
					['criterion', 'change', 'criterionId']
				)
			),
			resolvedStandards: array(object({ issueId: text, reason: text })),
		},
		['resolvedStandards']
	),
};

const qaChallengeSchema = report('challenge', challengeProperties);

/** Repair is transport, not a report type: callers must pass the original expected kind. */
export function teamReportSchema(
	expected: TurnKind,
	seat?: SeatRole,
	includeAppFields = false
): ReportSchema | undefined {
	const schema =
		expected === 'challenge' && seat === 'qa'
			? qaChallengeSchema
			: Object.prototype.hasOwnProperty.call(REPORT_SCHEMAS, expected)
				? REPORT_SCHEMAS[expected as TeamReport['type']]
				: undefined;
	if (!schema || includeAppFields) return schema;
	// Prompt schemas omit fields owned by another seat or by the application.
	const project = (value: ReportSchema): ReportSchema => {
		if ('anyOf' in value) return { anyOf: value.anyOf.map(project) };
		if (value.type === 'array') return { ...value, items: project(value.items) };
		if (value.type !== 'object') return value;
		const properties = Object.fromEntries(
			Object.entries(value.properties)
				.filter(
					([key]) =>
						key !== 'decider' &&
						(!seat || seat === 'dev' || !['extraTurns', 'preservesDeadline'].includes(key)) &&
						(!seat || seat === 'pm' || key !== 'resolvedStandards')
				)
				.map(([key, child]) => [key, project(child)])
		);
		return {
			...value,
			properties,
			required: value.required.filter((key) =>
				Object.prototype.hasOwnProperty.call(properties, key)
			),
		};
	};
	return project(schema);
}
