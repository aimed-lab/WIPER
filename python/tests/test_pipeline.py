from __future__ import annotations

import numpy as np
import pandas as pd

from wiper.cli import main
from wiper.pipeline import run_wiper


def test_run_wiper_emits_legacy_shaped_columns():
    df = pd.DataFrame(
        {
            "a": ["V1", "V2", "V1"],
            "b": ["V2", "V3", "V3"],
            "w": [0.7, 0.6, 0.2],
        }
    )
    result = run_wiper(df, iterations=10, include_novel=False, device="cpu")
    frame = result.to_frame()
    expected = {
        "nodeA",
        "nodeB",
        "Degree",
        "W[0]",
        "UFC[0]",
        "logUFC[0]",
        "UFC[0] rank",
        "p-value[0]",
        "significance[0]",
        "W[10]",
        "UFC[10]",
        "logUFC[10]",
        "UFC[10] Rank",
        "p-value[10]",
        "significance[10]",
        "extended",
    }
    assert expected.issubset(frame.columns)
    assert len(frame) == 3
    assert frame["UFC[10]"].is_monotonic_decreasing
    assert set(frame["extended"]) == {"No"}
    assert np.all(np.isfinite(frame["W[10]"]))


def test_novel_edge_inference_adds_top_non_input_path():
    df = pd.DataFrame(
        {
            "a": ["A", "B", "C"],
            "b": ["B", "C", "D"],
            "w": [1.0, 1.0, 0.1],
        }
    )
    result = run_wiper(df, iterations=2, include_novel=True, device="cpu")
    frame = result.to_frame()
    novel = frame[frame["extended"] == "Yes"]
    assert len(novel) == 1
    assert {novel.iloc[0]["nodeA"], novel.iloc[0]["nodeB"]} == {"A", "C"}


def test_cli_smoke(tmp_path):
    inp = tmp_path / "edges.tsv"
    out = tmp_path / "out.tsv"
    inp.write_text("node1\tnode2\tweight\nA\tB\t0.9\nB\tC\t0.8\n", encoding="utf-8")
    code = main(
        [
            "--interactions",
            str(inp),
            "-o",
            str(out),
            "--iterations",
            "3",
            "--device",
            "cpu",
            "--no-include-novel",
        ]
    )
    assert code == 0
    text = out.read_text(encoding="utf-8")
    assert "nodeA\tnodeB" in text
    assert "W[3]" in text


def test_cli_pathflow_smoke(tmp_path):
    inp = tmp_path / "edges.tsv"
    out = tmp_path / "out.tsv"
    inp.write_text(
        "node1\tnode2\tweight\nA\tB\t0.9\nB\tC\t0.9\nA\tC\t0.5\n",
        encoding="utf-8",
    )
    code = main(
        [
            "--algorithm",
            "pathflow",
            "--interactions",
            str(inp),
            "-o",
            str(out),
            "--iterations",
            "3",
            "--device",
            "cpu",
        ]
    )
    assert code == 0
    text = out.read_text(encoding="utf-8")
    assert "W[3]" in text
