// Parser for M3U / M3U8 playlists (the format used by most media players,
// DJ software, and streaming clients to describe an ordered list of tracks).
//
// The format itself is barely a spec: a plain M3U is just one URI per line,
// and the "extended" variant adds #EXTINF lines carrying duration and title
// ahead of each URI. Most parsers out there are lenient to a fault - they'll
// happily accept a duration that isn't a number, or an EXTINF with no track
// after it, and pass the mess downstream. This one refuses that input and
// tells you exactly which line is wrong.

export interface PlaylistEntry {
  uri: string;
  // Seconds. -1 is the conventional value for "unknown length" (live streams).
  duration?: number;
  title?: string;
  // Present when the URI is a variant stream in an HLS master playlist,
  // i.e. it was preceded by an #EXT-X-STREAM-INF tag rather than #EXTINF.
  streamInfo?: StreamInfo;
}

export interface StreamInfo {
  // Peak segment bitrate in bits per second - the one required attribute.
  bandwidth: number;
  averageBandwidth?: number;
  resolution?: { width: number; height: number };
  codecs?: string;
  frameRate?: number;
}

export interface Playlist {
  // Whether the source had an #EXTM3U header, i.e. whether EXTINF metadata
  // is meaningful for this playlist. A plain M3U file is still valid input.
  extended: boolean;
  entries: PlaylistEntry[];
}

export class ParseError extends Error {
  readonly line: number;

  constructor(line: number, message: string) {
    super(`line ${line}: ${message}`);
    this.name = 'ParseError';
    this.line = line;
  }
}

const EXTM3U = '#EXTM3U';
const EXTINF_PREFIX = '#EXTINF:';
const STREAM_INF_PREFIX = '#EXT-X-STREAM-INF:';
const CONTROL_CHARS = /[\x00-\x1f]/;

type PendingTag =
  | { kind: 'extinf'; duration: number; title: string; line: number }
  | { kind: 'stream-inf'; streamInfo: StreamInfo; line: number };

function pendingTagMessage(pending: PendingTag): string {
  return pending.kind === 'extinf'
    ? 'EXTINF entry has no following track URI'
    : 'EXT-X-STREAM-INF entry has no following URI';
}

export function parse(text: string): Playlist {
  const lines = text.split(/\r\n|\r|\n/);
  const entries: PlaylistEntry[] = [];

  let extended = false;
  let startIndex = 0;
  if (lines.length > 0 && lines[0].trim() === EXTM3U) {
    extended = true;
    startIndex = 1;
  }

  let pending: PendingTag | null = null;

  for (let i = startIndex; i < lines.length; i++) {
    const lineNumber = i + 1;
    const trimmed = lines[i].trim();

    if (trimmed === '') {
      continue;
    }

    if (trimmed === EXTM3U) {
      throw new ParseError(lineNumber, 'unexpected #EXTM3U header outside line 1');
    }

    if (trimmed.startsWith(EXTINF_PREFIX)) {
      if (pending !== null) {
        throw new ParseError(pending.line, pendingTagMessage(pending));
      }
      const info = parseExtinf(trimmed.slice(EXTINF_PREFIX.length), lineNumber);
      pending = { kind: 'extinf', duration: info.duration, title: info.title, line: lineNumber };
      continue;
    }

    if (trimmed.startsWith(STREAM_INF_PREFIX)) {
      if (pending !== null) {
        throw new ParseError(pending.line, pendingTagMessage(pending));
      }
      const streamInfo = parseStreamInf(trimmed.slice(STREAM_INF_PREFIX.length), lineNumber);
      pending = { kind: 'stream-inf', streamInfo, line: lineNumber };
      continue;
    }

    if (trimmed.startsWith('#')) {
      // Unknown comment or extension tag - not our concern, ignore it.
      continue;
    }

    if (CONTROL_CHARS.test(trimmed)) {
      throw new ParseError(lineNumber, 'track URI contains control characters');
    }

    const entry: PlaylistEntry = { uri: trimmed };
    if (pending !== null) {
      if (pending.kind === 'extinf') {
        entry.duration = pending.duration;
        entry.title = pending.title;
      } else {
        entry.streamInfo = pending.streamInfo;
      }
      pending = null;
    }
    entries.push(entry);
  }

  if (pending !== null) {
    throw new ParseError(pending.line, pendingTagMessage(pending));
  }

  return { extended, entries };
}

function parseExtinf(rest: string, lineNumber: number): { duration: number; title: string } {
  const commaIndex = rest.indexOf(',');
  if (commaIndex === -1) {
    throw new ParseError(lineNumber, 'EXTINF is missing the comma before the title');
  }

  const durationText = rest.slice(0, commaIndex).trim();
  const duration = Number(durationText);
  if (durationText === '' || Number.isNaN(duration)) {
    throw new ParseError(lineNumber, `EXTINF duration "${durationText}" is not a number`);
  }

  const title = rest.slice(commaIndex + 1).trim();
  return { duration, title };
}

function parseStreamInf(rest: string, lineNumber: number): StreamInfo {
  const attributes = parseAttributeList(rest, lineNumber);

  const bandwidthText = attributes.get('BANDWIDTH');
  if (bandwidthText === undefined) {
    throw new ParseError(lineNumber, 'EXT-X-STREAM-INF is missing the required BANDWIDTH attribute');
  }
  const streamInfo: StreamInfo = {
    bandwidth: parseNonNegativeInteger(bandwidthText, lineNumber, 'BANDWIDTH'),
  };

  const averageBandwidthText = attributes.get('AVERAGE-BANDWIDTH');
  if (averageBandwidthText !== undefined) {
    streamInfo.averageBandwidth = parseNonNegativeInteger(averageBandwidthText, lineNumber, 'AVERAGE-BANDWIDTH');
  }

  const resolutionText = attributes.get('RESOLUTION');
  if (resolutionText !== undefined) {
    const match = /^(\d+)x(\d+)$/.exec(resolutionText);
    if (match === null) {
      throw new ParseError(
        lineNumber,
        `EXT-X-STREAM-INF RESOLUTION "${resolutionText}" is not in WIDTHxHEIGHT form`
      );
    }
    streamInfo.resolution = { width: Number(match[1]), height: Number(match[2]) };
  }

  const codecs = attributes.get('CODECS');
  if (codecs !== undefined) {
    streamInfo.codecs = codecs;
  }

  const frameRateText = attributes.get('FRAME-RATE');
  if (frameRateText !== undefined) {
    const frameRate = Number(frameRateText);
    if (frameRateText === '' || Number.isNaN(frameRate)) {
      throw new ParseError(lineNumber, `EXT-X-STREAM-INF FRAME-RATE "${frameRateText}" is not a number`);
    }
    streamInfo.frameRate = frameRate;
  }

  return streamInfo;
}

function parseNonNegativeInteger(text: string, lineNumber: number, attributeName: string): number {
  const value = Number(text);
  if (!Number.isInteger(value) || value < 0) {
    throw new ParseError(
      lineNumber,
      `EXT-X-STREAM-INF ${attributeName} "${text}" is not a non-negative integer`
    );
  }
  return value;
}

// Splits an HLS attribute list ("KEY=value,KEY2="quoted, value"") into a map,
// respecting quoted values so commas inside them don't split the value apart.
function parseAttributeList(rest: string, lineNumber: number): Map<string, string> {
  const attributes = new Map<string, string>();
  let i = 0;

  while (i < rest.length) {
    while (i < rest.length && (rest[i] === ' ' || rest[i] === ',')) {
      i++;
    }
    if (i >= rest.length) {
      break;
    }

    const eqIndex = rest.indexOf('=', i);
    if (eqIndex === -1) {
      throw new ParseError(
        lineNumber,
        `EXT-X-STREAM-INF attribute "${rest.slice(i).trim()}" is missing "="`
      );
    }

    const key = rest.slice(i, eqIndex).trim();
    if (key === '') {
      throw new ParseError(lineNumber, 'EXT-X-STREAM-INF attribute name is empty');
    }
    i = eqIndex + 1;

    let value: string;
    if (rest[i] === '"') {
      const end = rest.indexOf('"', i + 1);
      if (end === -1) {
        throw new ParseError(lineNumber, `EXT-X-STREAM-INF attribute "${key}" has an unterminated quoted value`);
      }
      value = rest.slice(i + 1, end);
      i = end + 1;
    } else {
      const end = rest.indexOf(',', i);
      value = (end === -1 ? rest.slice(i) : rest.slice(i, end)).trim();
      i = end === -1 ? rest.length : end;
    }

    attributes.set(key, value);
  }

  return attributes;
}
