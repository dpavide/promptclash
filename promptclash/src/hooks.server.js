import { assignPromptToGame, initializeDatabase} from '$lib/api';

initializeDatabase();


export const handle = async ({ event, resolve}) => {
	return resolve(event);
};
