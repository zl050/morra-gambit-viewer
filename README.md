# Smith-Morra Repertoire Viewer

A standalone static website for browsing a curated Smith-Morra Gambit repertoire
by chapter, on an interactive board. Select a chapter, step through the lines,
read the annotations, search by PGN/FEN, and practise White's moves in quiz mode.

## Repertoire source & acknowledgements

The repertoire is based on *Mayhem in the Morra* by **Marc Esserman** — with
thanks to the author for the ideas behind these lines. It currently adapts the
common lines from a selection of the book's chapters and is **not yet
comprehensive**.

## Development

This repo uses [pnpm](https://pnpm.io/) (a `pnpm-lock.yaml` is committed). The
repertoire data is generated from PGN files with a small Python script.

```powershell
python -m pip install python-chess
pnpm install
python scripts/export_repertoire_json.py
pnpm run dev
```

Build static output for GitHub Pages:

```powershell
pnpm run build
```

## Data

PGN files in `data/pgn/` are the editable source of truth. Run
`scripts/export_repertoire_json.py` to regenerate `data/repertoire.json`.

- **Chapter description** comes from each PGN game's root comment — the `{...}`
  block placed between the headers and the first move. If a game has no root
  comment, a generated fallback is used.
- **Move annotations** come from the comment on the corresponding move.

## License & attribution

Licensed under the **GNU General Public License v3.0 or later**
(GPL-3.0-or-later) — see [LICENSE](LICENSE). The board UI bundles
[`chessground`](https://github.com/lichess-org/chessground) (GPL-3.0-or-later),
the open-source board library from Lichess, so the distributed application is
covered by the GPL.

[`chess.js`](https://github.com/jhlywa/chess.js) is used under the BSD-2-Clause
license.
