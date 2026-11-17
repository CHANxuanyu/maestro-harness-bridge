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
const report = (
	type: TeamReport['type'],
	properties: Record<string, ReportSchema>,
	optional: string[] = []
): ReportSchema => object({ type: { type: 'string', const: type }, ...properties }, optional);

const briefProperties = {
	scope: text,
	notDoing: strings(),
	criteria: array(
		object({ id: text, text, proof: choice('app', 'qa', 'pm'), how: text, experience: boolean }, [
			'experience',
		]),
		1
	),
	checks: array(object({ command: text, covers: strings(1) })),
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
	plans: array(object({ criterion: text, how: text, data: text }), 1),
};

/** Unknown properties are refused so a work report cannot smuggle in a verification verdict. */
export const REPORT_SCHEMAS: Record<TeamReport['type'], ReportSchema> = {
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
			waiting: nullable(object({ reason: text, waitFor: text })),
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
	topic: report('topic', {
		topic: text,
		why: text,
		participants: array(choice('pm', 'dev', 'qa'), 1),
	}),
};

const qaChallengeSchema = report('challenge', challengeProperties);

/** Repair is transport, not a report type: callers must pass the original expected kind. */
export function teamReportSchema(expected: TurnKind, seat?: SeatRole): ReportSchema | undefined {
	if (expected === 'challenge' && seat === 'qa') return qaChallengeSchema;
	return Object.prototype.hasOwnProperty.call(REPORT_SCHEMAS, expected)
		? REPORT_SCHEMAS[expected as TeamReport['type']]
		: undefined;
}
