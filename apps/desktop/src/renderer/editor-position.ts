export function restoredCursor(value: string | null, length: number): number {
  if (value === null || !/^\d+$/u.test(value)) return 0;
  const position = Number(value);
  return Number.isSafeInteger(position) ? Math.min(position, length) : 0;
}
