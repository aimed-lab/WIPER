"""Input and output helpers for WIPER edge lists."""

from __future__ import annotations

from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd


def _first_data_line(path: str | Path) -> list[str]:
    with Path(path).open("r", encoding="utf-8-sig") as handle:
        for line in handle:
            stripped = line.strip()
            if stripped:
                return stripped.split("\t")
    return []


def _looks_like_header(fields: list[str]) -> bool:
    if len(fields) < 3:
        return False
    try:
        float(fields[2])
    except ValueError:
        return True
    return False


def normalize_interactions(interactions: pd.DataFrame) -> pd.DataFrame:
    """Return canonical undirected edges with columns ``node_a,node_b,weight``.

    The last duplicate edge wins, matching the MATLAB/WINNER convention.
    """
    if interactions.shape[1] < 3:
        raise ValueError("interactions must have at least three columns")

    df = interactions.iloc[:, :3].copy()
    df.columns = ["node_a", "node_b", "weight"]
    df["node_a"] = df["node_a"].astype(str).str.strip()
    df["node_b"] = df["node_b"].astype(str).str.strip()
    df["weight"] = pd.to_numeric(df["weight"], errors="coerce").fillna(0.0)
    df["weight"] = df["weight"].clip(lower=0.0, upper=1.0)
    df = df[(df["node_a"] != "") & (df["node_b"] != "")]
    df = df[df["node_a"] != df["node_b"]].reset_index(drop=True)

    pairs = [
        (a, b) if a <= b else (b, a)
        for a, b in df[["node_a", "node_b"]].itertuples(index=False, name=None)
    ]
    df["_key_a"] = [p[0] for p in pairs]
    df["_key_b"] = [p[1] for p in pairs]
    df = df.drop_duplicates(["_key_a", "_key_b"], keep="last")
    df["node_a"] = df["_key_a"]
    df["node_b"] = df["_key_b"]
    return df[["node_a", "node_b", "weight"]].reset_index(drop=True)


def read_interactions(path: str | Path) -> pd.DataFrame:
    """Read a tab-delimited WIPER interaction file.

    Files with or without a header are accepted. Only the first three columns
    are used.
    """
    fields = _first_data_line(path)
    header = 0 if _looks_like_header(fields) else None
    df = pd.read_csv(path, sep="\t", header=header, engine="python")
    return normalize_interactions(df)


def nodes_from_interactions(interactions: pd.DataFrame) -> list[str]:
    """Return nodes in first-appearance order."""
    nodes: list[str] = []
    seen: set[str] = set()
    for a, b in interactions[["node_a", "node_b"]].itertuples(index=False):
        if a not in seen:
            nodes.append(a)
            seen.add(a)
        if b not in seen:
            nodes.append(b)
            seen.add(b)
    return nodes


def build_adjacency(
    interactions: pd.DataFrame,
    nodes: Iterable[str] | None = None,
) -> tuple[list[str], np.ndarray]:
    """Build a symmetric weighted adjacency matrix."""
    edge_df = normalize_interactions(interactions)
    node_list = list(nodes) if nodes is not None else nodes_from_interactions(edge_df)
    idx = pd.Series(np.arange(len(node_list), dtype=np.int64), index=node_list)
    i = edge_df["node_a"].map(idx).to_numpy()
    j = edge_df["node_b"].map(idx).to_numpy()
    valid = (~pd.isna(i)) & (~pd.isna(j))
    ii = i[valid].astype(np.int64)
    jj = j[valid].astype(np.int64)
    ww = edge_df["weight"].to_numpy(dtype=np.float64)[valid]

    adj = np.zeros((len(node_list), len(node_list)), dtype=np.float64)
    adj[ii, jj] = ww
    adj[jj, ii] = ww
    return node_list, adj


def write_wiper_result(path: str | Path, frame: pd.DataFrame) -> None:
    """Write a tab-delimited WIPER result file."""
    frame.to_csv(path, sep="\t", index=False)
