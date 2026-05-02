from __future__ import annotations

import pandas as pd

from wiper.io import normalize_interactions, read_interactions


def test_normalize_interactions_clips_weights_and_collapses_duplicates():
    df = pd.DataFrame(
        {
            "node1": ["B", "A", "C", "D"],
            "node2": ["A", "B", "C", "E"],
            "weight": [0.2, 1.5, 0.7, -1],
        }
    )
    out = normalize_interactions(df)
    assert out.to_dict("records") == [
        {"node_a": "A", "node_b": "B", "weight": 1.0},
        {"node_a": "D", "node_b": "E", "weight": 0.0},
    ]


def test_read_interactions_accepts_no_header(tmp_path):
    path = tmp_path / "edges.tsv"
    path.write_text("A\tB\t0.7\nB\tC\t0.6\n", encoding="utf-8")
    out = read_interactions(path)
    assert list(out.columns) == ["node_a", "node_b", "weight"]
    assert len(out) == 2


def test_read_interactions_accepts_header(tmp_path):
    path = tmp_path / "edges.tsv"
    path.write_text("node1\tnode2\tcombined_score\nA\tB\t0.7\n", encoding="utf-8")
    out = read_interactions(path)
    assert out.iloc[0].to_dict() == {"node_a": "A", "node_b": "B", "weight": 0.7}

