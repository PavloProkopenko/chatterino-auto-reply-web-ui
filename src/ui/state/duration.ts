/** The plugin allows a mute from 1 second to 14 days (engine.lua `add_redeem`). */
export const MAX_MUTE_SECONDS = 1_209_600;
export const LONG_MUTE_SECONDS = 86_400;

export const QUICK_DURATIONS = [
  { label: '1 мин', seconds: 60 },
  { label: '10 мин', seconds: 600 },
  { label: '1 ч', seconds: 3600 },
  { label: '1 д', seconds: 86_400 },
] as const;

const plural = (n: number, one: string, few: string, many: string) => {
  const t = n % 100;
  const u = n % 10;
  return t >= 11 && t <= 14 ? many : u === 1 ? one : u >= 2 && u <= 4 ? few : many;
};

/** "1 час 30 минут": the duration in words, for the line next to the field. */
export function describeDuration(total: number): string {
  let s = Math.max(0, Math.floor(total));
  const parts: string[] = [];
  for (const [size, one, few, many] of [
    [86_400, 'день', 'дня', 'дней'],
    [3600, 'час', 'часа', 'часов'],
    [60, 'минута', 'минуты', 'минут'],
    [1, 'секунда', 'секунды', 'секунд'],
  ] as const) {
    const n = Math.floor(s / size);
    s -= n * size;
    if (n > 0) parts.push(`${n} ${plural(n, one, few, many)}`);
  }
  return parts.join(' ') || '0 секунд';
}

/** The compact form the plugin's `util.parse_duration` reads ("1h30m"), for filling the field from a saved number. */
export function durationText(total: number): string {
  let s = Math.max(0, Math.floor(total));
  let out = '';
  for (const [size, unit] of [[86_400, 'd'], [3600, 'h'], [60, 'm'], [1, 's']] as const) {
    const n = Math.floor(s / size);
    s -= n * size;
    if (n > 0) out += `${n}${unit}`;
  }
  return out || '0s';
}
