// What the "Проверка" modal remembers between openings and between pages (the test message, who sends it, where,
// timer elapsed time, flags). In memory only: nothing is stored, and leaving the file resets it.
export const preview = $state({
  text: '',
  sender: '',
  channel: '',
  me: '',
  elapsed: '2h35m',
  flags: [] as string[],
});

export function resetPreview(): void {
  preview.text = '';
  preview.sender = '';
  preview.channel = '';
  preview.me = '';
  preview.elapsed = '2h35m';
  preview.flags = [];
}
