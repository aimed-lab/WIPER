"""High-level WIPER pipeline."""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Optional

import numpy as np
import pandas as pd

from .backend import Device
from .core import (
    EdgeSet,
    ant_colony_iteration,
    build_edge_network,
    combine_edges,
    infer_novel_edges,
    initial_edge_scores,
    input_edges_from_adjacency,
    optimal_path_matrix,
)
from .io import build_adjacency, normalize_interactions
from .pathflow import InitialScore, PairWeight, ShareMode, path_usage_matrix, winner_initial_score, winner_restart_iteration
from .stats import competition_rank_desc, ranking_pvalues, significance_symbols, ufc_scores


def _empty_edges() -> EdgeSet:
    empty_i = np.array([], dtype=np.int64)
    return EdgeSet([], [], empty_i, empty_i, np.array([], dtype=np.float64), np.array([], dtype=bool))


def _rank_in_network(ranks: np.ndarray, top_label: str) -> list[str]:
    return [f"{int(r)}({top_label})" for r in ranks]


@dataclass
class WiperResult:
    """Container for WIPER edge-ranking output."""

    node_a: list[str]
    node_b: list[str]
    degree: np.ndarray
    w0: np.ndarray
    ufc0: np.ndarray
    log_ufc0: np.ndarray
    pvalue0: np.ndarray
    significance0: np.ndarray
    w_final: np.ndarray
    ufc_final: np.ndarray
    log_ufc_final: np.ndarray
    pvalue_final: np.ndarray
    significance_final: np.ndarray
    extended: np.ndarray
    iterations: int

    def to_frame(self) -> pd.DataFrame:
        """Return a legacy-shaped WIPER result table."""
        label0 = [f"{a}:{b}" for a, b in zip(self.node_a, self.node_b)]
        if label0:
            top0 = label0[int(np.argmax(self.ufc0))]
            top_final = label0[int(np.argmax(self.ufc_final))]
        else:
            top0 = ""
            top_final = ""
        rank0 = competition_rank_desc(self.ufc0)
        rank_final = competition_rank_desc(self.ufc_final)
        n = self.iterations
        return pd.DataFrame(
            {
                "nodeA": self.node_a,
                "nodeB": self.node_b,
                "Degree": self.degree.astype(int),
                "W[0]": self.w0,
                "UFC[0]": self.ufc0,
                "logUFC[0]": self.log_ufc0,
                "UFC[0] rank": rank0,
                "UFC[0] rank in network": _rank_in_network(rank0, top0),
                "p-value[0]": self.pvalue0,
                "significance[0]": self.significance0,
                f"W[{n}]": self.w_final,
                f"UFC[{n}]": self.ufc_final,
                f"logUFC[{n}]": self.log_ufc_final,
                f"UFC[{n}] Rank": rank_final,
                f"UFC[{n}] rank in network": _rank_in_network(rank_final, top_final),
                f"p-value[{n}]": self.pvalue_final,
                f"significance[{n}]": self.significance_final,
                "extended": np.where(self.extended, "Yes", "No"),
            }
        )


def _sort_result(result: WiperResult) -> WiperResult:
    order = np.lexsort(
        (
            np.asarray(result.node_b, dtype=object),
            np.asarray(result.node_a, dtype=object),
            -result.ufc_final,
        )
    )
    return WiperResult(
        node_a=[result.node_a[i] for i in order],
        node_b=[result.node_b[i] for i in order],
        degree=result.degree[order],
        w0=result.w0[order],
        ufc0=result.ufc0[order],
        log_ufc0=result.log_ufc0[order],
        pvalue0=result.pvalue0[order],
        significance0=result.significance0[order],
        w_final=result.w_final[order],
        ufc_final=result.ufc_final[order],
        log_ufc_final=result.log_ufc_final[order],
        pvalue_final=result.pvalue_final[order],
        significance_final=result.significance_final[order],
        extended=result.extended[order],
        iterations=result.iterations,
    )


def run_wiper(
    interactions: pd.DataFrame,
    *,
    sigma: float = 0.2,
    iterations: int = 200,
    include_novel: bool = True,
    max_hops: Optional[int] = None,
    confidence_cutoff: float = 0.0,
    device: Device = "auto",
    n_jobs: int = -1,
    chunk_size: int = 1000,
) -> WiperResult:
    """Run full WIPER edge ranking.

    ``interactions`` must contain endpoint columns and a weight column. Values
    are normalized through :func:`wiper.io.normalize_interactions`.
    """
    edge_df = normalize_interactions(interactions)
    if edge_df.empty:
        empty = np.array([], dtype=np.float64)
        return WiperResult(
            node_a=[],
            node_b=[],
            degree=np.array([], dtype=np.int64),
            w0=empty,
            ufc0=empty,
            log_ufc0=empty,
            pvalue0=empty,
            significance0=np.array([], dtype=object),
            w_final=empty,
            ufc_final=empty,
            log_ufc_final=empty,
            pvalue_final=empty,
            significance_final=np.array([], dtype=object),
            extended=np.array([], dtype=bool),
            iterations=iterations,
        )

    nodes, adj = build_adjacency(edge_df)
    d, hops = optimal_path_matrix(adj)
    original_direct = input_edges_from_adjacency(nodes, adj)
    if original_direct.size == 0:
        edges = _empty_edges()
    else:
        original = replace(
            original_direct,
            strength=d[original_direct.i, original_direct.j].astype(np.float64),
        )
        if include_novel:
            novel = infer_novel_edges(
                nodes,
                d,
                original_direct,
                mean_weight=float(edge_df["weight"].mean()),
            )
            edges = combine_edges(original, novel)
        else:
            edges = original

    x = build_edge_network(
        edges,
        d,
        hops,
        confidence_cutoff=confidence_cutoff,
        max_hops=max_hops,
        chunk_size=chunk_size,
        n_jobs=n_jobs,
    )
    w0, degree = initial_edge_scores(x)
    w_final = ant_colony_iteration(
        x,
        w0,
        iterations=iterations,
        sigma=sigma,
        device=device,
    )
    ufc0, log0 = ufc_scores(w0)
    ufc_final, log_final = ufc_scores(w_final)
    p0 = ranking_pvalues(log0)
    pf = ranking_pvalues(log_final)

    return _sort_result(
        WiperResult(
            node_a=edges.node_a,
            node_b=edges.node_b,
            degree=degree,
            w0=w0,
            ufc0=ufc0,
            log_ufc0=log0,
            pvalue0=p0,
            significance0=significance_symbols(p0),
            w_final=w_final,
            ufc_final=ufc_final,
            log_ufc_final=log_final,
            pvalue_final=pf,
            significance_final=significance_symbols(pf),
            extended=edges.extended,
            iterations=iterations,
        )
    )


def run_wiper1(
    interactions: pd.DataFrame,
    *,
    sigma: float = 0.2,
    iterations: int = 200,
    include_novel: bool = True,
    max_hops: Optional[int] = None,
    confidence_cutoff: float = 0.0,
    device: Device = "auto",
    n_jobs: int = -1,
    chunk_size: int = 1000,
) -> WiperResult:
    """Run WIPER1, the paper/deck-faithful endpoint-distance algorithm."""
    return run_wiper(
        interactions,
        sigma=sigma,
        iterations=iterations,
        include_novel=include_novel,
        max_hops=max_hops,
        confidence_cutoff=confidence_cutoff,
        device=device,
        n_jobs=n_jobs,
        chunk_size=chunk_size,
    )


def run_path_wiper(
    interactions: pd.DataFrame,
    *,
    sigma: float = 0.85,
    iterations: int = 200,
    pair_weight: PairWeight = "uniform",
    share_mode: ShareMode = "strength",
    initial_score: InitialScore = "winner",
    tie_tolerance: float = 1e-12,
    max_paths_per_pair: int = 1024,
    device: Device = "auto",
    n_jobs: int = -1,
    source_chunk_size: int | None = None,
) -> WiperResult:
    """Run path-aware WIPER.

    This variant ranks edges by actual all-pairs shortest-path usage before
    applying WINNER-style restart propagation over an edge co-path graph.
    """
    edge_df = normalize_interactions(interactions)
    if edge_df.empty:
        empty = np.array([], dtype=np.float64)
        return WiperResult(
            node_a=[],
            node_b=[],
            degree=np.array([], dtype=np.int64),
            w0=empty,
            ufc0=empty,
            log_ufc0=empty,
            pvalue0=empty,
            significance0=np.array([], dtype=object),
            w_final=empty,
            ufc_final=empty,
            log_ufc_final=empty,
            pvalue_final=empty,
            significance_final=np.array([], dtype=object),
            extended=np.array([], dtype=bool),
            iterations=iterations,
        )

    nodes, adj = build_adjacency(edge_df)
    matrices = path_usage_matrix(
        adj,
        nodes=nodes,
        pair_weight=pair_weight,
        share_mode=share_mode,
        tie_tolerance=tie_tolerance,
        max_paths_per_pair=max_paths_per_pair,
        n_jobs=n_jobs,
        source_chunk_size=source_chunk_size,
    )
    if initial_score == "winner":
        w0 = winner_initial_score(matrices.edge_graph, matrices.path_load)
    elif initial_score == "path_load":
        w0 = matrices.path_load
    else:
        raise ValueError("initial_score must be 'winner' or 'path_load'")

    degree = np.asarray(matrices.edge_graph.getnnz(axis=1), dtype=np.int64)
    w_final = winner_restart_iteration(
        matrices.edge_graph,
        w0,
        iterations=iterations,
        sigma=sigma,
        device=device,
    )
    ufc0, log0 = ufc_scores(w0)
    ufc_final, log_final = ufc_scores(w_final)
    p0 = ranking_pvalues(log0)
    pf = ranking_pvalues(log_final)

    return _sort_result(
        WiperResult(
            node_a=matrices.edges.node_a,
            node_b=matrices.edges.node_b,
            degree=degree,
            w0=w0,
            ufc0=ufc0,
            log_ufc0=log0,
            pvalue0=p0,
            significance0=significance_symbols(p0),
            w_final=w_final,
            ufc_final=ufc_final,
            log_ufc_final=log_final,
            pvalue_final=pf,
            significance_final=significance_symbols(pf),
            extended=matrices.edges.extended,
            iterations=iterations,
        )
    )


def run_wiper2(
    interactions: pd.DataFrame,
    *,
    sigma: float = 0.85,
    iterations: int = 200,
    pair_weight: PairWeight = "uniform",
    share_mode: ShareMode = "strength",
    initial_score: InitialScore = "winner",
    tie_tolerance: float = 1e-12,
    max_paths_per_pair: int = 1024,
    device: Device = "auto",
    n_jobs: int = -1,
    source_chunk_size: int | None = None,
) -> WiperResult:
    """Run WIPER2, the shortest-path-flow/WINNER-style edge algorithm."""
    return run_path_wiper(
        interactions,
        sigma=sigma,
        iterations=iterations,
        pair_weight=pair_weight,
        share_mode=share_mode,
        initial_score=initial_score,
        tie_tolerance=tie_tolerance,
        max_paths_per_pair=max_paths_per_pair,
        device=device,
        n_jobs=n_jobs,
        source_chunk_size=source_chunk_size,
    )


def devices_report() -> str:
    from .backend import available_devices

    return f"available devices: {', '.join(available_devices())}"
