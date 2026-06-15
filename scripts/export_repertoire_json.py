#!/usr/bin/env python3
"""Export curated Smith-Morra PGN files to a compact browser JSON tree."""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
for local_package_dir in (ROOT / ".pydeps", ROOT / ".python-packages"):
    if local_package_dir.exists():
        sys.path.insert(0, str(local_package_dir))

try:
    import chess.pgn
except ImportError as exc:  # pragma: no cover - exercised by environment setup
    raise SystemExit(
        "Missing dependency: python-chess. Install it with "
        "`python -m pip install python-chess`."
    ) from exc


PGN_DIR = ROOT / "data" / "pgn"
OUTPUT_PATH = ROOT / "data" / "repertoire.json"
REQUIRED_HEADERS = ("Event", "White", "Black", "Result")
COMMENT_LIMIT = 320


@dataclass(frozen=True)
class ExportContext:
    chapter_id: str
    nodes: list[dict]


def main() -> int:
    chapters = []
    for pgn_path in sorted(PGN_DIR.glob("smg_chp*_mainlines.pgn"), key=chapter_sort_key):
        chapters.append(export_chapter(pgn_path))

    if not chapters:
        raise SystemExit(f"No PGN files found in {PGN_DIR}")

    payload = {"chapters": chapters}
    OUTPUT_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Exported {len(chapters)} chapters to {OUTPUT_PATH.relative_to(ROOT)}")
    return 0


def export_chapter(pgn_path: Path) -> dict:
    with pgn_path.open("r", encoding="utf-8") as handle:
        game = chess.pgn.read_game(handle)
        trailing = handle.read().strip()

    if game is None:
        raise ValueError(f"{pgn_path.name}: no PGN game found")
    if trailing:
        raise ValueError(f"{pgn_path.name}: expected exactly one PGN game")
    if getattr(game, "errors", None):
        raise ValueError(f"{pgn_path.name}: PGN parse errors: {game.errors}")

    validate_headers(pgn_path, game)

    chapter_id = chapter_id_from_path(pgn_path)
    root_board = game.board()
    root_id = f"{chapter_id}-root"
    context = ExportContext(
        chapter_id=chapter_id,
        nodes=[
            {
                "id": root_id,
                "parentId": None,
                "san": None,
                "uci": None,
                "ply": root_board.ply(),
                "fen": root_board.fen(),
                "children": [],
                "isMainline": True,
            }
        ],
    )

    walk_variations(game, root_board, root_id, context, parent_is_mainline=True)

    return {
        "id": chapter_id,
        "title": game.headers["Black"],
        "sourcePgn": pgn_path.name,
        "rootFen": root_board.fen(),
        "description": chapter_description(game),
        "nodes": context.nodes,
    }


def walk_variations(parent_node, board, parent_id: str, context: ExportContext, parent_is_mainline: bool) -> None:
    parent_payload = node_by_id(context.nodes, parent_id)

    for variation_index, child_node in enumerate(parent_node.variations):
        move = child_node.move
        san = board.san(move)
        next_board = board.copy(stack=False)
        next_board.push(move)

        child_id = f"{context.chapter_id}-n{len(context.nodes)}"
        child_is_mainline = parent_is_mainline and variation_index == 0
        payload = {
            "id": child_id,
            "parentId": parent_id,
            "san": san,
            "uci": move.uci(),
            "ply": next_board.ply(),
            "fen": next_board.fen(),
            "children": [],
            "isMainline": child_is_mainline,
        }

        comment = normalize_comment(child_node.comment)
        if comment:
            payload["description"] = comment

        context.nodes.append(payload)
        parent_payload["children"].append(child_id)
        walk_variations(child_node, next_board, child_id, context, child_is_mainline)


def validate_headers(pgn_path: Path, game) -> None:
    missing = [header for header in REQUIRED_HEADERS if not game.headers.get(header)]
    if missing:
        raise ValueError(f"{pgn_path.name}: missing required headers: {', '.join(missing)}")

    has_fen = bool(game.headers.get("FEN"))
    has_setup = game.headers.get("SetUp") == "1"
    if has_fen != has_setup:
        raise ValueError(f"{pgn_path.name}: FEN and SetUp \"1\" must be provided together")


def chapter_id_from_path(pgn_path: Path) -> str:
    match = re.search(r"smg_chp(\d+)_mainlines\.pgn$", pgn_path.name)
    if not match:
        raise ValueError(f"Unexpected PGN filename: {pgn_path.name}")
    return f"ch{int(match.group(1))}"


def chapter_sort_key(pgn_path: Path) -> int:
    return int(re.search(r"smg_chp(\d+)_mainlines\.pgn$", pgn_path.name).group(1))


def chapter_description(game) -> str:
    """Chapter description: the PGN game's root comment when present (the curated
    source of truth for chapter-specific prose), else a generated fallback."""
    comment = " ".join(game.comment.split())
    if comment:
        return comment
    return fallback_chapter_description(game.headers)


def fallback_chapter_description(headers) -> str:
    title = headers["Black"]
    event = headers["Event"]
    if "Declined" in title or "From 2.d4" in event:
        focus = "Smith-Morra declined structures and early deviations"
    elif "3...d3" in event:
        focus = "the 3...d3 sideline and White's development plan"
    else:
        focus = "accepted Smith-Morra positions, initiative, and Black's defensive setup"
    return f"Study {title}. Follow the chapter tree to compare {focus}."


def normalize_comment(comment: str) -> str:
    text = " ".join(comment.split())
    if not text:
        return ""
    if len(text) > COMMENT_LIMIT:
        raise ValueError("PGN comment is too long for MVP export; keep node descriptions short and original")
    return text


def node_by_id(nodes: list[dict], node_id: str) -> dict:
    for node in nodes:
        if node["id"] == node_id:
            return node
    raise KeyError(node_id)


if __name__ == "__main__":
    sys.exit(main())
