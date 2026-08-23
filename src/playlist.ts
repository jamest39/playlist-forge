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
const CONTROL_CHARS = /[\x00-\x1f]/;

interface PendingInfo {
  duration: number;
  title: string;
  line: number;
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

  let pending: PendingInfo | null = null;

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
        throw new ParseError(pending.line, 'EXTINF entry has no following track URI');
      }
      pending = parseExtinf(trimmed.slice(EXTINF_PREFIX.length), lineNumber);
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
      entry.duration = pending.duration;
      entry.title = pending.title;
      pending = null;
    }
    entries.push(entry);
  }

  if (pending !== null) {
    throw new ParseError(pending.line, 'EXTINF entry has no following track URI');
  }

  return { extended, entries };
}

function parseExtinf(rest: string, lineNumber: number): PendingInfo {
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
  return { duration, title, line: lineNumber };
}
