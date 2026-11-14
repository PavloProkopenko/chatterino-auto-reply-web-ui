import { mount } from 'svelte';
import App from './App.svelte';
import { lua } from './lua.ts';
import './app.css';

// Test-only seam: the e2e build (VITE_E2E=1) lets Playwright call the same Lua client the app uses.
if (import.meta.env.VITE_E2E === '1') (window as unknown as { __e2e: unknown }).__e2e = { lua };

mount(App, { target: document.getElementById('app')! });
