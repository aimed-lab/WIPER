from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest


HISTORICAL_FILES = [
    Path(
        "/Users/jakechen/Library/CloudStorage/Box-Box/My Profession/My Projects/"
        "Current/GBM PDX U01/RT-Selected Pairs/WIPER/DE_wiper_result/global_Edges.txt"
    ),
    Path("/Users/jakechen/Library/CloudStorage/Box-Box/ISMB2019/ALZ680/Edgeattr.txt"),
]


@pytest.mark.parametrize("path", HISTORICAL_FILES)
def test_historical_wiper_outputs_have_expected_shape(path: Path):
    if not path.exists():
        pytest.skip(f"historical WIPER output not present: {path}")
    frame = pd.read_csv(path, sep="\t", nrows=25)
    joined = "\t".join(frame.columns)
    assert ("nodeA" in frame.columns and "nodeB" in frame.columns) or "Node" in frame.columns
    assert "p-value" in joined
    assert "Degree" in frame.columns
    assert any("W[" in col or "R[" in col for col in frame.columns)

