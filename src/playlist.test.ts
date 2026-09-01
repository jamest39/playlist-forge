// A hand-rolled test runner instead of a framework dependency - the project
// stays at zero third-party packages, and this is little enough code that a
// framework would not save anything. Run with `npm test`.

import { parse, print, ParseError } from './index.js';

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }
  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  return aKeys.every((key) =>
    deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
  );
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (!deepEqual(actual, expected)) {
    throw new Error(
      `${message}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`
    );
  }
}

function assertThrows(fn: () => void, check: (error: ParseError) => void): void {
  try {
    fn();
  } catch (error) {
    if (!(error instanceof ParseError)) {
      throw new Error(`expected a ParseError, got ${String(error)}`);
    }
    check(error);
    return;
  }
  throw new Error('expected a ParseError but no error was thrown');
}

const failures: { name: string; error: unknown }[] = [];
let passCount = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passCount++;
  } catch (error) {
    failures.push({ name, error });
  }
}

test('plain playlist without an EXTM3U header', () => {
  const playlist = parse('track1.mp3\ntrack2.mp3\n');
  assertEqual(playlist.extended, false, 'extended flag');
  assertEqual(playlist.entries, [{ uri: 'track1.mp3' }, { uri: 'track2.mp3' }], 'entries');
});

test('extended playlist attaches duration and title to the following track', () => {
  const source = '#EXTM3U\n#EXTINF:245,Boards of Canada - Roygbiv\nmusic/boc/roygbiv.mp3\n';
  const playlist = parse(source);
  assertEqual(playlist.extended, true, 'extended flag');
  assertEqual(
    playlist.entries,
    [{ uri: 'music/boc/roygbiv.mp3', duration: 245, title: 'Boards of Canada - Roygbiv' }],
    'entries'
  );
});

test('blank lines between entries are ignored', () => {
  const playlist = parse('#EXTM3U\n\n#EXTINF:10,Track\n\ntrack.mp3\n\n');
  assertEqual(playlist.entries, [{ uri: 'track.mp3', duration: 10, title: 'Track' }], 'entries');
});

test('leading and trailing whitespace on a track line is trimmed', () => {
  const playlist = parse('  track.mp3  \n');
  assertEqual(playlist.entries, [{ uri: 'track.mp3' }], 'entries');
});

test('CRLF line endings are treated the same as LF', () => {
  const playlist = parse('#EXTM3U\r\n#EXTINF:10,Track\r\ntrack.mp3\r\n');
  assertEqual(playlist.extended, true, 'extended flag');
  assertEqual(playlist.entries, [{ uri: 'track.mp3', duration: 10, title: 'Track' }], 'entries');
});

test('lone CR line endings are treated the same as LF', () => {
  const playlist = parse('track1.mp3\rtrack2.mp3\r');
  assertEqual(playlist.entries, [{ uri: 'track1.mp3' }, { uri: 'track2.mp3' }], 'entries');
});

test('a second #EXTM3U header is rejected', () => {
  assertThrows(
    () => parse('#EXTM3U\ntrack1.mp3\n#EXTM3U\ntrack2.mp3\n'),
    (error) => {
      assertEqual(error.line, 3, 'error line');
      assertEqual(error.message, 'line 3: unexpected #EXTM3U header outside line 1', 'error message');
    }
  );
});

test('EXTINF without a comma is rejected', () => {
  assertThrows(
    () => parse('#EXTM3U\n#EXTINF:245 Roygbiv\ntrack.mp3\n'),
    (error) => {
      assertEqual(error.line, 2, 'error line');
      assertEqual(error.message, 'line 2: EXTINF is missing the comma before the title', 'error message');
    }
  );
});

test('a non-numeric EXTINF duration is rejected', () => {
  assertThrows(
    () => parse('#EXTM3U\n#EXTINF:not-a-number,Bad Entry\ntrack.mp3\n'),
    (error) => {
      assertEqual(error.line, 2, 'error line');
      assertEqual(
        error.message,
        'line 2: EXTINF duration "not-a-number" is not a number',
        'error message'
      );
    }
  );
});

test('an EXTINF with a blank duration is rejected', () => {
  assertThrows(
    () => parse('#EXTM3U\n#EXTINF: ,Title\ntrack.mp3\n'),
    (error) => {
      assertEqual(error.line, 2, 'error line');
      assertEqual(error.message, 'line 2: EXTINF duration "" is not a number', 'error message');
    }
  );
});

test('an EXTINF at end of file with no track after it is rejected', () => {
  assertThrows(
    () => parse('#EXTM3U\n#EXTINF:245,Roygbiv\n'),
    (error) => {
      assertEqual(error.line, 2, 'error line');
      assertEqual(error.message, 'line 2: EXTINF entry has no following track URI', 'error message');
    }
  );
});

test('two consecutive EXTINF lines are rejected', () => {
  assertThrows(
    () => parse('#EXTM3U\n#EXTINF:1,First\n#EXTINF:2,Second\ntrack.mp3\n'),
    (error) => {
      assertEqual(error.line, 2, 'error line');
      assertEqual(error.message, 'line 2: EXTINF entry has no following track URI', 'error message');
    }
  );
});

test('a track URI containing a control character is rejected', () => {
  assertThrows(
    () => parse('#EXTM3U\ntrack\t.mp3\n'),
    (error) => {
      assertEqual(error.line, 2, 'error line');
      assertEqual(error.message, 'line 2: track URI contains control characters', 'error message');
    }
  );
});

test('unrecognized tags are ignored rather than rejected', () => {
  const playlist = parse('#EXTM3U\n#EXTVLCOPT:some-option=1\n#EXTINF:10,Track\ntrack.mp3\n');
  assertEqual(playlist.entries, [{ uri: 'track.mp3', duration: 10, title: 'Track' }], 'entries');
});

test('a duration of -1 is accepted for live streams', () => {
  const playlist = parse(
    '#EXTM3U\n#EXTINF:-1,Radio Paradise (live)\nhttps://stream.radioparadise.com/mp3-320\n'
  );
  assertEqual(playlist.entries[0]?.duration, -1, 'duration');
});

test('a fractional EXTINF duration is accepted', () => {
  const playlist = parse('#EXTM3U\n#EXTINF:245.5,Track\ntrack.mp3\n');
  assertEqual(playlist.entries[0]?.duration, 245.5, 'duration');
});

test('an EXTINF with an empty title is accepted', () => {
  const playlist = parse('#EXTM3U\n#EXTINF:10,\ntrack.mp3\n');
  assertEqual(playlist.entries[0]?.title, '', 'title');
});

test('an #EXTM3U header with surrounding whitespace is still recognized', () => {
  const playlist = parse('  #EXTM3U  \ntrack.mp3\n');
  assertEqual(playlist.extended, true, 'extended flag');
});

test('ParseError carries its line number and a prefixed message', () => {
  assertThrows(
    () => parse('#EXTM3U\n#EXTM3U\n'),
    (error) => {
      assertEqual(error.name, 'ParseError', 'error name');
      assertEqual(error.line, 2, 'error line');
    }
  );
});

test('print() output parses back to an equal playlist', () => {
  const source =
    '#EXTM3U\n#EXTINF:245,Boards of Canada - Roygbiv\nmusic/boc/roygbiv.mp3\n' +
    '#EXTINF:-1,Radio Paradise (live)\nhttps://stream.radioparadise.com/mp3-320\n';
  const playlist = parse(source);
  const printed = print(playlist);
  assertEqual(printed, source, 'canonical output');
  assertEqual(parse(printed), playlist, 'round-tripped playlist');
});

test('print() formats a fractional duration with three decimal places', () => {
  const printed = print({
    extended: true,
    entries: [{ uri: 'track.mp3', duration: 245.5, title: 'Track' }],
  });
  assertEqual(printed, '#EXTM3U\n#EXTINF:245.500,Track\ntrack.mp3\n', 'printed output');
});

test('empty input parses to an empty, non-extended playlist', () => {
  const playlist = parse('');
  assertEqual(playlist, { extended: false, entries: [] }, 'playlist');
});

test('input containing only blank lines parses to no entries', () => {
  const playlist = parse('\n\n   \n\n');
  assertEqual(playlist.entries, [], 'entries');
});

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`FAIL: ${failure.name}`);
    console.error(failure.error instanceof Error ? failure.error.message : String(failure.error));
  }
  console.error(`${failures.length} failing, ${passCount} passing`);
  throw new Error(`${failures.length} test(s) failed`);
}

console.log(`${passCount} passing`);
