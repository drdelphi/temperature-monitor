export const CHANNEL_HUES = [
  '#e07a3d',
  '#3d9ad6',
  '#c9a227',
  '#5aaa78',
  '#c45c5c',
  '#6b7fc4',
  '#c4844a',
  '#4aa8a8',
] as const;

export function channelHue(index: number): string {
  return CHANNEL_HUES[index % CHANNEL_HUES.length] ?? CHANNEL_HUES[0];
}
