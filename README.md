# playlist-forge

A validating parser and pretty printer for M3U / M3U8 audio playlists.

## Why

M3U is everywhere - media players, DJ software, podcast apps, streaming
clients all read and write it - but the format is barely specified. A plain
M3U is one URI per line; the "extended" variant adds `#EXTINF` lines carrying
a duration and title ahead of each track. Most parsers accept whatever you
throw at them: a non-numeric duration, an `#EXTINF` with no track after it,
a stray control character in a path. That garbage then gets written back out
and breaks something downstream.

This library does the opposite. `parse()` either returns a well-formed
`Playlist` or throws a `ParseError` that names the exact line and what was
wrong with it. `print()` renders a `Playlist` back to text in one canonical
style, so round-tripping a file through parse and print always produces the
same bytes.

## Usage

```ts
import { parse, print, ParseError } from './src/index.js';

const source = `#EXTM3U
#EXTINF:245,Boards of Canada - Roygbiv
music/boc/roygbiv.mp3
#EXTINF:-1,Radio Paradise (live)
https://stream.radioparadise.com/mp3-320
`;

const playlist = parse(source);

console.log(playlist.entries.length); // 2
console.log(playlist.entries[0].title); // "Boards of Canada - Roygbiv"
console.log(playlist.entries[1].duration); // -1 (unknown length, e.g. a live stream)

// print() is the inverse of parse() for well-formed input
console.log(print(playlist) === source); // true

try {
  parse('#EXTM3U\n#EXTINF:not-a-number,Bad Entry\ntrack.mp3\n');
} catch (err) {
  if (err instanceof ParseError) {
    console.log(err.message); // "line 2: EXTINF duration \"not-a-number\" is not a number"
  }
}
```

## What counts as invalid

- An `#EXTM3U` header anywhere other than line 1.
- An `#EXTINF` line missing the comma that separates duration from title.
- An `#EXTINF` duration that isn't a number.
- An `#EXTINF` line with no track URI after it (including at end of file).
- A track line containing control characters.

Plain (non-extended) playlists are accepted as-is - a bare list of URIs with
no `#EXTM3U` header is valid input, it just carries no duration or title
metadata.

## Building

```
npm run build
```

No third-party dependencies - the whole thing is standard library TypeScript.

## Status

Early. The parser and printer cover core M3U/M3U8 today; see the roadmap for
what's next.
