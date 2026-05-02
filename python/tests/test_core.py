from __future__ import annotations

import numpy as np
import pandas as pd
import pytest
from scipy.sparse import csr_matrix

from wiper.core import (
    ant_colony_iteration,
    build_edge_network,
    initial_edge_scores,
    input_edges_from_adjacency,
    optimal_path_matrix,
)
from wiper.io import build_adjacency


def toy_interactions() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "a": ["V1", "V2", "V1"],
            "b": ["V2", "V3", "V3"],
            "w": [0.7, 0.6, 0.2],
        }
    )


def test_optimal_path_matrix_matches_deck_toy_example():
    nodes, adj = build_adjacency(toy_interactions())
    assert nodes == ["V1", "V2", "V3"]
    d, hops = optimal_path_matrix(adj)

    np.testing.assert_allclose(d[0, 1], 0.7, rtol=1e-12)
    np.testing.assert_allclose(d[1, 2], 0.6, rtol=1e-12)
    np.testing.assert_allclose(d[0, 2], 0.42, rtol=1e-12)
    assert hops[0, 2] == 1.0
    assert d[0, 0] == 1.0


def test_edge_network_x_matches_deck_toy_relationships():
    nodes, adj = build_adjacency(toy_interactions())
    d, hops = optimal_path_matrix(adj)
    edges = input_edges_from_adjacency(nodes, adj)
    # WIPER's X formula uses D endpoints; update direct edge strengths to D.
    edges = type(edges)(
        edges.node_a,
        edges.node_b,
        edges.i,
        edges.j,
        d[edges.i, edges.j],
        edges.extended,
    )
    x = build_edge_network(edges, d, hops, chunk_size=2, n_jobs=1).toarray()

    assert np.allclose(np.diag(x), 0.0)
    # Upper-triangle edge order is E12, E13, E23.
    np.testing.assert_allclose(x[0, 1], 0.294, rtol=1e-12)
    np.testing.assert_allclose(x[0, 2], 0.42, rtol=1e-12)
    np.testing.assert_allclose(x[1, 2], 0.252, rtol=1e-12)
    np.testing.assert_allclose(x, x.T, rtol=1e-12)


def test_initial_edge_scores_are_sum_squared_over_degree():
    x = csr_matrix(
        np.array(
            [
                [0.0, 2.0, 0.0],
                [1.0, 0.0, 1.0],
                [0.0, 3.0, 0.0],
            ]
        )
    )
    score, degree = initial_edge_scores(x)
    np.testing.assert_array_equal(degree, np.array([1, 2, 1]))
    np.testing.assert_allclose(score, np.array([4.0, 2.0, 9.0]))


def test_iteration_zero_returns_initial_score():
    x = csr_matrix(np.array([[0.0, 1.0], [1.0, 0.0]]))
    w0 = np.array([1.0, 2.0])
    out = ant_colony_iteration(x, w0, iterations=0, sigma=0.2, device="cpu")
    np.testing.assert_allclose(out, w0)


def test_isolated_edges_do_not_decay():
    x = csr_matrix((2, 2), dtype=float)
    w0 = np.array([1.0, 2.0])
    out = ant_colony_iteration(x, w0, iterations=10, sigma=0.2, device="cpu")
    np.testing.assert_allclose(out, w0)


def test_torch_dispatch_matches_cpu_when_available():
    pytest.importorskip("torch")
    x = csr_matrix(np.array([[0.0, 1.0], [1.0, 0.0]]))
    w0 = np.array([1.0, 2.0])
    cpu = ant_colony_iteration(x, w0, iterations=5, sigma=0.2, device="cpu")
    torch_out = ant_colony_iteration(x, w0, iterations=5, sigma=0.2, device="auto")
    np.testing.assert_allclose(torch_out, cpu, rtol=1e-6)
