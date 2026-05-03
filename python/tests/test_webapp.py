from __future__ import annotations

import pandas as pd

from wiper import run_wiper1, run_wiper2
from wiper.webapp import analyze_edges_text, read_interactions_text


def test_wiper1_wiper2_public_aliases_work():
    df = pd.DataFrame(
        {
            "a": ["A", "B", "A"],
            "b": ["B", "C", "C"],
            "w": [0.9, 0.9, 0.5],
        }
    )
    assert len(run_wiper1(df, iterations=2, include_novel=False, device="cpu").to_frame()) == 3
    assert len(run_wiper2(df, iterations=2, device="cpu").to_frame()) == 3


def test_read_interactions_text_accepts_headered_tsv():
    frame = read_interactions_text("node1\tnode2\tweight\nA\tB\t0.7\nB\tC\t0.8\n")
    assert list(frame.columns) == ["node_a", "node_b", "weight"]
    assert frame["weight"].tolist() == [0.7, 0.8]


def test_analyze_edges_text_returns_visualization_payload():
    payload = analyze_edges_text(
        "node1\tnode2\tweight\nA\tB\t0.9\nB\tC\t0.9\nA\tC\t0.5\n",
        iterations=3,
        include_novel=False,
        device="cpu",
    )
    assert payload["summary"]["nodeCount"] == 3
    assert payload["summary"]["inputEdgeCount"] == 3
    assert {"winner", "logWinner", "rank"}.issubset(payload["nodes"][0])
    assert len(payload["edges"]) == 3
    first = payload["edges"][0]
    assert {"rawWeight", "wiper1", "wiper2"}.issubset(first)
    assert first["wiper2"]["pathLoad"] is not None
