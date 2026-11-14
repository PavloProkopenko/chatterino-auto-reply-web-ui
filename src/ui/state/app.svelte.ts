import { createClient, readToken } from '../data/client.ts';
import { lua } from '../lua.ts';
import { Session } from './session.svelte.ts';
import { channelValidator, userValidator } from './validators.ts';

export const client = createClient(readToken());
export const session = new Session({ api: client });

export const nav = $state({ historyOpen: false, showPath: false });

export const validateChannel = channelValidator(lua);
export const validateUser = userValidator(lua);
