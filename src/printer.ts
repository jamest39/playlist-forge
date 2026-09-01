import { Playlist } from './playlist.js';

// Renders a Playlist back to M3U text in a single canonical style: LF line
// endings, integer durations without decimals, and no blank lines. Feeding
// the output back through parse() always yields an equal Playlist.
export function print(playlist: Playlist): string {
  const lines: string[] = [];

  if (playlist.extended) {
    lines.push('#EXTM3U');
  }

  for (const entry of playlist.entries) {
    if (entry.duration !== undefined) {
      lines.push(`#EXTINF:${formatDuration(entry.duration)},${entry.title ?? ''}`);
    }
    lines.push(entry.uri);
  }

  return lines.length > 0 ? lines.join('\n') + '\n' : '';
}

function formatDuration(duration: number): string {
  return Number.isInteger(duration) ? String(duration) : duration.toFixed(3);
}
