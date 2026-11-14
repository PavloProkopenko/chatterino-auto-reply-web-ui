import { expect, test } from 'vitest';
import { preview, resetPreview } from '../../src/ui/state/preview-state.svelte.ts';

test('starts empty with the default elapsed time, and reset puts everything back', () => {
  expect(preview).toEqual({ text: '', sender: '', channel: '', me: '', elapsed: '2h35m', flags: [] });
  preview.text = 'привет';
  preview.sender = 'viewer';
  preview.flags = ['first'];
  resetPreview();
  expect(preview).toEqual({ text: '', sender: '', channel: '', me: '', elapsed: '2h35m', flags: [] });
});
