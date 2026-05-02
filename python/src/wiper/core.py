"""Core WIPER numerical routines."""

from __future__ import annotations

from dataclasses import dataclass
from math import ceil
from typing import Optional

import numpy as np
from scipy.sparse import coo_matrix, csr_matrix, diags
from scipy.sparse.csgraph import shortest_path

from .backend import Device, resolve_device


@dataclass(frozen=True)
class EdgeSet:
    """Indexed WIPER edges."""

    node_a: list[str]
    node_b: list[str]
    i: np.ndarray
    j: np.ndarray
    strength: np.ndarray
    extended: np.ndarray

    @property
    def size(self) -> int:
        return int(self.i.size)


def optimal_path_matrix(adj: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Compute WIPER's node-to-node optimal path matrix ``D``.

    Edge probabilities are transformed to costs with ``-log(weight)`` and
    shortest paths are converted back with ``exp(-distance)``. The returned hop
    matrix is the unweighted shortest-path length and is used only for optional
    edge-to-edge filtering.
    """
    adj = np.asarray(adj, dtype=np.float64)
    if adj.ndim != 2 or adj.shape[0] != adj.shape[1]:
        raise ValueError("adj must be a square matrix")
    n = adj.shape[0]
    rows, cols = np.nonzero(adj > 0)
    if rows.size == 0:
        d = np.eye(n, dtype=np.float64)
        hops = np.zeros((n, n), dtype=np.float64)
        hops[hops == 0] = np.inf
        np.fill_diagonal(hops, 0.0)
        return d, hops

    clipped = np.clip(adj[rows, cols], np.finfo(np.float64).tiny, 1.0)
    costs = -np.log(clipped)
    graph = csr_matrix((costs, (rows, cols)), shape=(n, n))
    dist = shortest_path(graph, directed=False, unweighted=False)
    with np.errstate(over="ignore"):
        d = np.exp(-dist)
    d[~np.isfinite(d)] = 0.0
    np.fill_diagonal(d, 1.0)

    hop_graph = csr_matrix((np.ones(rows.size, dtype=np.float64), (rows, cols)), shape=(n, n))
    hops = shortest_path(hop_graph, directed=False, unweighted=True)
    np.fill_diagonal(hops, 0.0)
    return d.astype(np.float64, copy=False), hops.astype(np.float64, copy=False)


def input_edges_from_adjacency(nodes: list[str], adj: np.ndarray) -> EdgeSet:
    """Return original graph edges from the upper triangle of ``adj``."""
    ii, jj = np.where(np.triu(adj, k=1) > 0)
    strength = adj[ii, jj].astype(np.float64, copy=False)
    return EdgeSet(
        node_a=[nodes[i] for i in ii],
        node_b=[nodes[j] for j in jj],
        i=ii.astype(np.int64),
        j=jj.astype(np.int64),
        strength=strength,
        extended=np.zeros(ii.size, dtype=bool),
    )


def infer_novel_edges(
    nodes: list[str],
    d: np.ndarray,
    original_edges: EdgeSet,
    *,
    mean_weight: float,
    fraction: float = 0.10,
) -> EdgeSet:
    """Infer novel edges from high-scoring non-input pairs in ``D``."""
    n = len(nodes)
    if original_edges.size == 0 or fraction <= 0:
        empty = np.array([], dtype=np.int64)
        return EdgeSet([], [], empty, empty, np.array([], dtype=np.float64), np.array([], dtype=bool))

    original_pairs = set(zip(original_edges.i.tolist(), original_edges.j.tolist()))
    ii, jj = np.triu_indices(n, k=1)
    score = d[ii, jj]
    keep = score >= mean_weight
    keep &= score > 0
    if not np.any(keep):
        empty = np.array([], dtype=np.int64)
        return EdgeSet([], [], empty, empty, np.array([], dtype=np.float64), np.array([], dtype=bool))

    cand_i = ii[keep]
    cand_j = jj[keep]
    cand_score = score[keep]
    not_original = np.array(
        [(int(a), int(b)) not in original_pairs for a, b in zip(cand_i, cand_j)],
        dtype=bool,
    )
    cand_i = cand_i[not_original]
    cand_j = cand_j[not_original]
    cand_score = cand_score[not_original]
    if cand_i.size == 0:
        empty = np.array([], dtype=np.int64)
        return EdgeSet([], [], empty, empty, np.array([], dtype=np.float64), np.array([], dtype=bool))

    limit = max(1, int(ceil(fraction * original_edges.size)))
    order = np.lexsort((cand_j, cand_i, -cand_score))[:limit]
    ni = cand_i[order].astype(np.int64)
    nj = cand_j[order].astype(np.int64)
    ns = cand_score[order].astype(np.float64)
    return EdgeSet(
        node_a=[nodes[i] for i in ni],
        node_b=[nodes[j] for j in nj],
        i=ni,
        j=nj,
        strength=ns,
        extended=np.ones(ni.size, dtype=bool),
    )


def combine_edges(original: EdgeSet, novel: EdgeSet) -> EdgeSet:
    """Concatenate original and novel edge sets."""
    if novel.size == 0:
        return original
    return EdgeSet(
        node_a=original.node_a + novel.node_a,
        node_b=original.node_b + novel.node_b,
        i=np.concatenate([original.i, novel.i]),
        j=np.concatenate([original.j, novel.j]),
        strength=np.concatenate([original.strength, novel.strength]),
        extended=np.concatenate([original.extended, novel.extended]),
    )


def _edge_network_chunk(
    start: int,
    end: int,
    edges_i: np.ndarray,
    edges_j: np.ndarray,
    edge_strength: np.ndarray,
    d: np.ndarray,
    hops: np.ndarray,
    confidence_cutoff: float,
    max_hops: Optional[int],
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    row_i = edges_i[start:end][:, None]
    row_j = edges_j[start:end][:, None]
    col_i = edges_i[None, :]
    col_j = edges_j[None, :]

    bridge = np.maximum.reduce(
        [
            d[row_i, col_i],
            d[row_i, col_j],
            d[row_j, col_i],
            d[row_j, col_j],
        ]
    )
    x = edge_strength[start:end, None] * edge_strength[None, :] * bridge

    if max_hops is not None:
        bridge_hops = np.minimum.reduce(
            [
                hops[row_i, col_i],
                hops[row_i, col_j],
                hops[row_j, col_i],
                hops[row_j, col_j],
            ]
        )
        x[bridge_hops > max_hops] = 0.0

    if confidence_cutoff > 0:
        x[x <= confidence_cutoff] = 0.0

    diag_cols = np.arange(start, end, dtype=np.int64)
    x[np.arange(end - start, dtype=np.int64), diag_cols] = 0.0
    local_rows, cols = np.nonzero(x > 0)
    rows = local_rows.astype(np.int64) + start
    data = x[local_rows, cols].astype(np.float64, copy=False)
    return rows, cols.astype(np.int64), data


def _effective_n_jobs(n_jobs: int) -> int:
    return 1 if n_jobs == 0 else n_jobs


def build_edge_network(
    edges: EdgeSet,
    d: np.ndarray,
    hops: np.ndarray,
    *,
    confidence_cutoff: float = 0.0,
    max_hops: Optional[int] = None,
    chunk_size: int = 1000,
    n_jobs: int = 1,
) -> csr_matrix:
    """Build sparse edge-to-edge traversal matrix ``X`` in chunks."""
    m = edges.size
    if m == 0:
        return csr_matrix((0, 0), dtype=np.float64)
    if chunk_size <= 0:
        raise ValueError("chunk_size must be positive")
    starts = list(range(0, m, chunk_size))
    jobs = _effective_n_jobs(n_jobs)

    def one(start: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        return _edge_network_chunk(
            start,
            min(m, start + chunk_size),
            edges.i,
            edges.j,
            edges.strength,
            d,
            hops,
            confidence_cutoff,
            max_hops,
        )

    if jobs == 1 or len(starts) == 1:
        parts = [one(s) for s in starts]
    else:
        from joblib import Parallel, delayed

        parts = Parallel(n_jobs=jobs, backend="threading")(delayed(one)(s) for s in starts)

    nonempty = [p for p in parts if p[0].size]
    if not nonempty:
        return csr_matrix((m, m), dtype=np.float64)
    rows = np.concatenate([p[0] for p in nonempty])
    cols = np.concatenate([p[1] for p in nonempty])
    data = np.concatenate([p[2] for p in nonempty])
    return coo_matrix((data, (rows, cols)), shape=(m, m), dtype=np.float64).tocsr()


def initial_edge_scores(x: csr_matrix) -> tuple[np.ndarray, np.ndarray]:
    """Compute WIPER ``W[0]`` and edge-network degree."""
    degree = np.asarray(x.getnnz(axis=1), dtype=np.int64)
    row_sum = np.asarray(x.sum(axis=1)).ravel().astype(np.float64)
    score = np.zeros(x.shape[0], dtype=np.float64)
    valid = degree > 0
    score[valid] = (row_sum[valid] ** 2) / degree[valid]
    return score, degree


def _row_normalized(x: csr_matrix) -> tuple[csr_matrix, np.ndarray]:
    row_sum = np.asarray(x.sum(axis=1)).ravel().astype(np.float64)
    outflow = (row_sum > 0).astype(np.float64)
    inv = np.zeros_like(row_sum)
    inv[row_sum > 0] = 1.0 / row_sum[row_sum > 0]
    return (diags(inv) @ x).tocsr(), outflow


def ant_colony_iteration_cpu(
    x: csr_matrix,
    initial_score: np.ndarray,
    *,
    iterations: int = 200,
    sigma: float = 0.2,
) -> np.ndarray:
    """Iterate WIPER ant-colony information flow on CPU."""
    if iterations < 0:
        raise ValueError("iterations must be non-negative")
    if not (0 < sigma <= 1):
        raise ValueError("sigma must be in (0, 1]")
    p, outflow = _row_normalized(x)
    w = np.asarray(initial_score, dtype=np.float64).copy()
    pt = p.T.tocsr()
    for _ in range(iterations):
        inflow = pt @ w
        w = w - sigma * (w * outflow - inflow)
    return w


def ant_colony_iteration_torch(
    x: csr_matrix,
    initial_score: np.ndarray,
    *,
    iterations: int = 200,
    sigma: float = 0.2,
    device: Device = "auto",
) -> np.ndarray:
    """Iterate WIPER flow with PyTorch sparse matrix multiplication."""
    import torch

    resolved = resolve_device(device)
    if resolved == "cpu":
        return ant_colony_iteration_cpu(x, initial_score, iterations=iterations, sigma=sigma)

    p, outflow = _row_normalized(x)
    pt = p.T.tocoo()
    dev = torch.device(resolved)
    indices = torch.as_tensor(np.vstack([pt.row, pt.col]), dtype=torch.long, device=dev)
    values = torch.as_tensor(pt.data, dtype=torch.float32, device=dev)
    mat = torch.sparse_coo_tensor(indices, values, pt.shape, device=dev).coalesce()
    w = torch.as_tensor(initial_score, dtype=torch.float32, device=dev)
    out = torch.as_tensor(outflow, dtype=torch.float32, device=dev)
    for _ in range(iterations):
        inflow = torch.sparse.mm(mat, w.unsqueeze(1)).squeeze(1)
        w = w - sigma * (w * out - inflow)
    return w.detach().cpu().numpy().astype(np.float64, copy=False)


def ant_colony_iteration(
    x: csr_matrix,
    initial_score: np.ndarray,
    *,
    iterations: int = 200,
    sigma: float = 0.2,
    device: Device = "auto",
) -> np.ndarray:
    """Dispatch WIPER flow to CPU or optional PyTorch device."""
    resolved = resolve_device(device)
    if resolved != "cpu":
        try:
            return ant_colony_iteration_torch(
                x, initial_score, iterations=iterations, sigma=sigma, device=resolved
            )
        except (ImportError, RuntimeError, NotImplementedError):
            pass
    return ant_colony_iteration_cpu(x, initial_score, iterations=iterations, sigma=sigma)
