"""Path-aware WIPER variant.

This module implements a corrected/alternative edge-ranking pipeline:

1. Compute all-pairs optimal paths on ``-log(edge_weight)`` costs.
2. Build a sparse ``WP`` matrix whose rows are input edges and whose columns
   are node pairs. ``WP[e, s:t]`` is the share of shortest-path credit assigned
   to edge ``e`` for pair ``s,t``.
3. Build an edge graph from shortest-path co-use: ``A_edge = WP @ WP.T``.
4. Run WINNER-style restart propagation over ``A_edge``.

The original paper-faithful WIPER constructs edge-to-edge scores from endpoint
distances. This pathflow variant asks whether an edge actually lies on optimal
paths.
"""

from __future__ import annotations

from dataclasses import dataclass
from heapq import heappop, heappush
import os
from typing import Literal

import numpy as np
from scipy.sparse import coo_matrix, csr_matrix, diags

from .backend import Device, resolve_device
from .core import EdgeSet, input_edges_from_adjacency, optimal_path_matrix

PairWeight = Literal["uniform", "path_strength"]
ShareMode = Literal["strength", "cost"]
InitialScore = Literal["winner", "path_load"]


@dataclass(frozen=True)
class PathFlowMatrices:
    """Matrices and edge metadata for path-aware WIPER."""

    edges: EdgeSet
    wp: csr_matrix
    edge_graph: csr_matrix
    path_load: np.ndarray
    pair_count: int


def _cost_matrix(adj: np.ndarray) -> np.ndarray:
    costs = np.full(adj.shape, np.inf, dtype=np.float64)
    mask = adj > 0
    upper = np.nextafter(1.0, 0.0)
    costs[mask] = -np.log(np.clip(adj[mask], np.finfo(np.float64).tiny, upper))
    np.fill_diagonal(costs, 0.0)
    return costs


def _adjacency_lists(adj: np.ndarray, edges: EdgeSet) -> list[list[tuple[int, float, int]]]:
    n = adj.shape[0]
    cost = _cost_matrix(adj)
    edge_idx: dict[tuple[int, int], int] = {}
    for idx, (i, j) in enumerate(zip(edges.i.tolist(), edges.j.tolist())):
        edge_idx[(i, j)] = idx
        edge_idx[(j, i)] = idx

    out: list[list[tuple[int, float, int]]] = [[] for _ in range(n)]
    ii, jj = np.nonzero(adj > 0)
    for i, j in zip(ii.tolist(), jj.tolist()):
        if i == j:
            continue
        out[i].append((j, float(cost[i, j]), edge_idx[(i, j)]))
    return out


def _dijkstra_all_predecessors(
    graph: list[list[tuple[int, float, int]]],
    source: int,
    *,
    tie_tolerance: float,
) -> tuple[np.ndarray, list[list[tuple[int, int]]]]:
    n = len(graph)
    dist = np.full(n, np.inf, dtype=np.float64)
    pred: list[list[tuple[int, int]]] = [[] for _ in range(n)]
    dist[source] = 0.0
    heap: list[tuple[float, int]] = [(0.0, source)]
    while heap:
        du, u = heappop(heap)
        if du > dist[u] + tie_tolerance:
            continue
        for v, cost, edge_idx in graph[u]:
            nd = du + cost
            if nd < dist[v] - tie_tolerance:
                dist[v] = nd
                pred[v] = [(u, edge_idx)]
                heappush(heap, (nd, v))
            elif abs(nd - dist[v]) <= tie_tolerance:
                pred[v].append((u, edge_idx))
    return dist, pred


def _enumerate_paths(
    pred: list[list[tuple[int, int]]],
    source: int,
    target: int,
    *,
    max_paths: int,
) -> list[list[int]]:
    paths: list[list[int]] = []

    def walk(node: int, edge_acc: list[int]) -> None:
        if len(paths) >= max_paths:
            raise RuntimeError("too many tied shortest paths")
        if node == source:
            paths.append(edge_acc[::-1])
            return
        for prev, edge_idx in pred[node]:
            walk(prev, edge_acc + [edge_idx])

    walk(target, [])
    return paths


def _pair_column(source: int, target: int, n: int) -> int:
    """Return the zero-based upper-triangle column for ``source < target``."""
    return source * (2 * n - source - 1) // 2 + (target - source - 1)


def _effective_n_jobs(n_jobs: int) -> int:
    if n_jobs == 0:
        return 1
    if n_jobs < 0:
        return max(1, (os.cpu_count() or 1) + 1 + n_jobs)
    return n_jobs


def _source_path_credit_chunk(
    graph: list[list[tuple[int, float, int]]],
    d: np.ndarray,
    share_values: np.ndarray,
    n: int,
    source_start: int,
    source_stop: int,
    pair_weight: PairWeight,
    tie_tolerance: float,
    max_paths_per_pair: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, int]:
    rows: list[int] = []
    cols: list[int] = []
    data: list[float] = []
    reachable = 0

    for source in range(source_start, source_stop):
        dist, pred = _dijkstra_all_predecessors(graph, source, tie_tolerance=tie_tolerance)
        for target in range(source + 1, n):
            if not np.isfinite(dist[target]):
                continue
            paths = _enumerate_paths(
                pred, source, target, max_paths=max_paths_per_pair
            )
            if not paths:
                continue
            reachable += 1
            credit = 1.0 if pair_weight == "uniform" else float(d[source, target])
            per_path_credit = credit / len(paths)
            edge_credit: dict[int, float] = {}
            for path in paths:
                denom = float(np.sum(share_values[path]))
                if denom <= 0 or not np.isfinite(denom):
                    continue
                for edge_idx in path:
                    edge_credit[edge_idx] = edge_credit.get(edge_idx, 0.0) + (
                        per_path_credit * float(share_values[edge_idx]) / denom
                    )
            col = _pair_column(source, target, n)
            for edge_idx, value in edge_credit.items():
                if value > 0:
                    rows.append(edge_idx)
                    cols.append(col)
                    data.append(value)

    return (
        np.asarray(rows, dtype=np.int64),
        np.asarray(cols, dtype=np.int64),
        np.asarray(data, dtype=np.float64),
        reachable,
    )


def path_usage_matrix(
    adj: np.ndarray,
    *,
    nodes: list[str] | None = None,
    pair_weight: PairWeight = "uniform",
    share_mode: ShareMode = "strength",
    tie_tolerance: float = 1e-12,
    max_paths_per_pair: int = 1024,
    n_jobs: int = 1,
    source_chunk_size: int | None = None,
) -> PathFlowMatrices:
    """Build the edge-by-node-pair shortest-path credit matrix ``WP``.

    Tied shortest paths are split equally. If a pair has more than
    ``max_paths_per_pair`` tied paths, a ``RuntimeError`` is raised so callers
    do not silently get arbitrary path credit.

    CPU parallelism is source-wise: different workers run Dijkstra and path
    credit construction for disjoint source-node blocks. This is the dominant
    WIPER2 cost on medium and large networks, so ``n_jobs=-1`` can materially
    reduce wall time when the graph is large enough to amortize process
    scheduling and serialization.
    """
    if pair_weight not in ("uniform", "path_strength"):
        raise ValueError("pair_weight must be 'uniform' or 'path_strength'")
    if share_mode not in ("strength", "cost"):
        raise ValueError("share_mode must be 'strength' or 'cost'")

    n = adj.shape[0]
    node_names = nodes if nodes is not None else [str(i) for i in range(n)]
    edges = input_edges_from_adjacency(node_names, adj)
    if edges.size == 0:
        empty = csr_matrix((0, 0), dtype=np.float64)
        return PathFlowMatrices(edges, empty, empty, np.zeros(0, dtype=np.float64), 0)

    graph = _adjacency_lists(adj, edges)
    d, _ = optimal_path_matrix(adj)
    upper = np.nextafter(1.0, 0.0)
    costs = -np.log(np.clip(edges.strength, np.finfo(np.float64).tiny, upper))
    share_values = edges.strength if share_mode == "strength" else costs

    jobs = _effective_n_jobs(n_jobs)
    if source_chunk_size is None:
        source_chunk_size = max(1, n // max(1, jobs * 4))
    if source_chunk_size <= 0:
        raise ValueError("source_chunk_size must be positive")
    chunks = [(start, min(n, start + source_chunk_size)) for start in range(0, n, source_chunk_size)]

    if jobs == 1 or len(chunks) == 1:
        parts = [
            _source_path_credit_chunk(
                graph,
                d,
                share_values,
                n,
                start,
                stop,
                pair_weight,
                tie_tolerance,
                max_paths_per_pair,
            )
            for start, stop in chunks
        ]
    else:
        from joblib import Parallel, delayed

        tasks = [
            delayed(_source_path_credit_chunk)(
                graph,
                d,
                share_values,
                n,
                start,
                stop,
                pair_weight,
                tie_tolerance,
                max_paths_per_pair,
            )
            for start, stop in chunks
        ]
        try:
            parts = Parallel(n_jobs=jobs, prefer="processes")(tasks)
        except (OSError, NotImplementedError):
            parts = Parallel(n_jobs=jobs, backend="threading")(tasks)

    reachable = int(sum(part[3] for part in parts))
    nonempty = [part for part in parts if part[0].size]
    if nonempty:
        rows = np.concatenate([part[0] for part in nonempty])
        pair_cols = np.concatenate([part[1] for part in nonempty])
        data = np.concatenate([part[2] for part in nonempty])
        used_cols, cols = np.unique(pair_cols, return_inverse=True)
        pair_count = int(used_cols.size)
    else:
        rows = np.array([], dtype=np.int64)
        cols = np.array([], dtype=np.int64)
        data = np.array([], dtype=np.float64)
        pair_count = 0

    wp = coo_matrix((data, (rows, cols)), shape=(edges.size, pair_count), dtype=np.float64).tocsr()
    edge_graph = (wp @ wp.T).tocsr()
    edge_graph.setdiag(0.0)
    edge_graph.eliminate_zeros()
    path_load = np.asarray(wp.sum(axis=1)).ravel().astype(np.float64)
    return PathFlowMatrices(edges, wp, edge_graph, path_load, reachable)


def winner_initial_score(edge_graph: csr_matrix, path_load: np.ndarray) -> np.ndarray:
    """Compute WINNER-style ``wdeg^2 / degree`` initial edge-node scores."""
    degree = np.asarray(edge_graph.getnnz(axis=1), dtype=np.int64)
    wdeg = np.asarray(edge_graph.sum(axis=1)).ravel().astype(np.float64)
    score = np.zeros(edge_graph.shape[0], dtype=np.float64)
    valid = degree > 0
    score[valid] = (wdeg[valid] ** 2) / degree[valid]
    if np.any(~valid):
        score[~valid] = path_load[~valid]
    return score


def winner_restart_iteration_cpu(
    adj: csr_matrix,
    initial_score: np.ndarray,
    *,
    iterations: int = 200,
    sigma: float = 0.85,
) -> np.ndarray:
    """WINNER/PageRank-style restart propagation over an edge graph."""
    if iterations < 0:
        raise ValueError("iterations must be non-negative")
    if not (0 < sigma <= 1):
        raise ValueError("sigma must be in (0, 1]")
    row_sum = np.asarray(adj.sum(axis=1)).ravel().astype(np.float64)
    if np.any(row_sum == 0):
        adj = (adj + diags((row_sum == 0).astype(np.float64))).tocsr()
        row_sum = np.asarray(adj.sum(axis=1)).ravel().astype(np.float64)
    inv = np.zeros_like(row_sum)
    inv[row_sum > 0] = 1.0 / row_sum[row_sum > 0]
    p = (diags(inv) @ adj).tocsr()
    pt = p.T.tocsr()
    v0 = np.asarray(initial_score, dtype=np.float64)
    v = v0.copy()
    restart = (1.0 - sigma) * v0
    for _ in range(iterations):
        v = restart + sigma * (pt @ v)
    return v


def winner_restart_iteration_torch(
    adj: csr_matrix,
    initial_score: np.ndarray,
    *,
    iterations: int = 200,
    sigma: float = 0.85,
    device: Device = "auto",
) -> np.ndarray:
    """PyTorch sparse implementation of WINNER restart propagation."""
    import torch

    resolved = resolve_device(device)
    if resolved == "cpu":
        return winner_restart_iteration_cpu(adj, initial_score, iterations=iterations, sigma=sigma)

    row_sum = np.asarray(adj.sum(axis=1)).ravel().astype(np.float64)
    if np.any(row_sum == 0):
        adj = (adj + diags((row_sum == 0).astype(np.float64))).tocsr()
        row_sum = np.asarray(adj.sum(axis=1)).ravel().astype(np.float64)
    inv = np.zeros_like(row_sum)
    inv[row_sum > 0] = 1.0 / row_sum[row_sum > 0]
    p = (diags(inv) @ adj).T.tocoo()
    dev = torch.device(resolved)
    indices = torch.as_tensor(np.vstack([p.row, p.col]), dtype=torch.long, device=dev)
    values = torch.as_tensor(p.data, dtype=torch.float32, device=dev)
    mat = torch.sparse_coo_tensor(indices, values, p.shape, device=dev).coalesce()
    v0 = torch.as_tensor(initial_score, dtype=torch.float32, device=dev)
    v = v0.clone()
    restart = (1.0 - sigma) * v0
    for _ in range(iterations):
        v = restart + sigma * torch.sparse.mm(mat, v.unsqueeze(1)).squeeze(1)
    return v.detach().cpu().numpy().astype(np.float64, copy=False)


def winner_restart_iteration(
    adj: csr_matrix,
    initial_score: np.ndarray,
    *,
    iterations: int = 200,
    sigma: float = 0.85,
    device: Device = "auto",
) -> np.ndarray:
    """Dispatch WINNER restart propagation to CPU or optional PyTorch device."""
    resolved = resolve_device(device)
    if resolved != "cpu":
        try:
            return winner_restart_iteration_torch(
                adj, initial_score, iterations=iterations, sigma=sigma, device=resolved
            )
        except (ImportError, RuntimeError, NotImplementedError):
            pass
    return winner_restart_iteration_cpu(adj, initial_score, iterations=iterations, sigma=sigma)
