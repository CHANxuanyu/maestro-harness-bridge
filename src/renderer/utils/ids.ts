import { generateId } from '../../shared/uuid';
export { generateId } from '../../shared/uuid';

let inputBroadcastOriginId: string | null = null;

export const getInputBroadcastOriginId = (): string => {
	if (!inputBroadcastOriginId) {
		inputBroadcastOriginId = generateId();
	}
	return inputBroadcastOriginId;
};
