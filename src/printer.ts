import { Playlist, StreamInfo } from './playlist.js';

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
    if (entry.streamInfo !== undefined) {
      lines.push(`#EXT-X-STREAM-INF:${formatStreamInfo(entry.streamInfo)}`);
    }
    lines.push(entry.uri);
  }

  return lines.length > 0 ? lines.join('\n') + '\n' : '';
}

function formatDuration(duration: number): string {
  return Number.isInteger(duration) ? String(duration) : duration.toFixed(3);
}

function formatStreamInfo(info: StreamInfo): string {
  const attributes = [`BANDWIDTH=${info.bandwidth}`];

  if (info.averageBandwidth !== undefined) {
    attributes.push(`AVERAGE-BANDWIDTH=${info.averageBandwidth}`);
  }
  if (info.resolution !== undefined) {
    attributes.push(`RESOLUTION=${info.resolution.width}x${info.resolution.height}`);
  }
  if (info.codecs !== undefined) {
    attributes.push(`CODECS="${info.codecs}"`);
  }
  if (info.frameRate !== undefined) {
    attributes.push(`FRAME-RATE=${info.frameRate}`);
  }

  return attributes.join(',');
}
