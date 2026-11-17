import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type {
	ModelCatalogProvider,
	ModelCatalogRequest,
	ProviderModelCatalog,
} from '../../../shared/modelCatalog';
import type { SeatRole, TeamConfig } from '../../../shared/team/types';
import { useConversationModelCatalog } from '../../hooks/agent/useAgentModelEffortOptions';

type TeamCatalogs = Partial<
	Record<SeatRole, Partial<Record<ModelCatalogProvider, ProviderModelCatalog>>>
>;
const Catalogs = createContext<TeamCatalogs>({});

/** Warm catalogs per seat account, shared by every current and historical tag on this surface. */
export function TeamModelCatalogProvider({
	config,
	children,
}: {
	config: TeamConfig;
	children: ReactNode;
}) {
	const request = (seat: SeatRole, provider: ModelCatalogProvider): ModelCatalogRequest => ({
		provider,
		...(config.seats[seat].customEnv
			? { account: { customEnvVars: config.seats[seat].customEnv } }
			: {}),
		sshRemoteId: config.sshRemoteId,
	});
	// Both vendors can appear in a seat's history after a substitute takes over.
	const pmClaude = useConversationModelCatalog(request('pm', 'claude-code'), false);
	const pmCodex = useConversationModelCatalog(request('pm', 'codex'), false);
	const devClaude = useConversationModelCatalog(request('dev', 'claude-code'), false);
	const devCodex = useConversationModelCatalog(request('dev', 'codex'), false);
	const qaClaude = useConversationModelCatalog(request('qa', 'claude-code'), false);
	const qaCodex = useConversationModelCatalog(request('qa', 'codex'), false);
	const catalogs = useMemo(
		() => ({
			pm: { 'claude-code': pmClaude, codex: pmCodex },
			dev: { 'claude-code': devClaude, codex: devCodex },
			qa: { 'claude-code': qaClaude, codex: qaCodex },
		}),
		[pmClaude, pmCodex, devClaude, devCodex, qaClaude, qaCodex]
	);
	return <Catalogs.Provider value={catalogs}>{children}</Catalogs.Provider>;
}

export function useTeamModelCatalog(seat: SeatRole, provider?: string) {
	const catalogs = useContext(Catalogs);
	return provider === 'claude-code' || provider === 'codex'
		? catalogs[seat]?.[provider]
		: undefined;
}
