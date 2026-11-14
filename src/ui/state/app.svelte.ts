import { downloadText } from '../data/download.ts';
import { lazyPersistence } from '../data/persistence.ts';
import { createWorkspace } from '../data/workspace.ts';
import { lua } from '../lua.ts';
import { Session } from './session.svelte.ts';
import { channelValidator, userValidator } from './validators.ts';

// Everything runs in this page: the file layer talks to the browser's file APIs and IndexedDB, nothing goes over the network.
export const session = new Session({ workspace: createWorkspace({ persistence: lazyPersistence(), download: downloadText }) });

export type Page = 'rules' | 'settings';
export const nav = $state<{ historyOpen: boolean; page: Page }>({ historyOpen: false, page: 'settings' });

export const validateChannel = channelValidator(lua);
export const validateUser = userValidator(lua);
