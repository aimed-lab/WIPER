from __future__ import annotations

import numpy as np
import pandas as pd

from wiper.io import build_adjacency
from wiper.pathflow import path_usage_matrix, winner_restart_iteration
from wiper.pipeline import run_path_wiper


def test_path_usage_credits_edges_on_actual_shortest_paths():
    df = pd.DataFrame(
        {
            "a": ["A", "B", "A"],
            "b": ["B", "C", "C"],
            "w": [0.9, 0.9, 0.5],
        }
    )
    nodes, adj = build_adjacency(df)
    matrices = path_usage_matrix(adj, nodes=nodes)

    labels = list(zip(matrices.edges.node_a, matrices.edges.node_b))
    idx_ab = labels.index(("A", "B"))
    idx_bc = labels.index(("B", "C"))
    idx_ac = labels.index(("A", "C"))

    np.testing.assert_allclose(matrices.path_load[idx_ab], 1.5)
    np.testing.assert_allclose(matrices.path_load[idx_bc], 1.5)
    np.testing.assert_allclose(matrices.path_load[idx_ac], 0.0)
    np.testing.assert_allclose(matrices.edge_graph[idx_ab, idx_bc], 0.25)


def test_path_usage_splits_tied_shortest_paths():
    df = pd.DataFrame(
        {
            "a": ["A", "B", "A", "C"],
            "b": ["B", "D", "C", "D"],
            "w": [0.9, 0.9, 0.9, 0.9],
        }
    )
    nodes, adj = build_adjacency(df)
    matrices = path_usage_matrix(adj, nodes=nodes)

    labels = list(zip(matrices.edges.node_a, matrices.edges.node_b))
    idx_ab = labels.index(("A", "B"))
    idx_ac = labels.index(("A", "C"))
    # AB and AC each get one direct-pair credit plus quarter credits from two
    # tied opposite-corner pairs in the diamond.
    np.testing.assert_allclose(matrices.path_load[idx_ab], 1.5)
    np.testing.assert_allclose(matrices.path_load[idx_ac], 1.5)


def test_run_path_wiper_ranks_used_edges_above_bypassed_edge():
    df = pd.DataFrame(
        {
            "a": ["A", "B", "A"],
            "b": ["B", "C", "C"],
            "w": [0.9, 0.9, 0.5],
        }
    )
    result = run_path_wiper(df, iterations=10, initial_score="path_load", device="cpu")
    frame = result.to_frame()
    bypassed = frame[(frame["nodeA"] == "A") & (frame["nodeB"] == "C")].iloc[0]
    assert bypassed["UFC[10]"] == 0.0
    assert frame.iloc[0]["UFC[10]"] > bypassed["UFC[10]"]


def test_winner_restart_keeps_isolated_scores_at_initial_value():
    from scipy.sparse import csr_matrix

    adj = csr_matrix((2, 2), dtype=float)
    initial = np.array([1.0, 2.0])
    out = winner_restart_iteration(adj, initial, iterations=20, sigma=0.85, device="cpu")
    np.testing.assert_allclose(out, initial)


def test_path_usage_parallel_matches_serial():
    df = pd.DataFrame(
        {
            "a": ["A", "B", "C", "D", "A", "B"],
            "b": ["B", "C", "D", "E", "C", "D"],
            "w": [0.95, 0.9, 0.85, 0.8, 0.6, 0.7],
        }
    )
    nodes, adj = build_adjacency(df)
    serial = path_usage_matrix(adj, nodes=nodes, n_jobs=1, source_chunk_size=1)
    parallel = path_usage_matrix(adj, nodes=nodes, n_jobs=2, source_chunk_size=1)

    assert serial.pair_count == parallel.pair_count
    np.testing.assert_allclose(serial.path_load, parallel.path_load)
    np.testing.assert_allclose(serial.edge_graph.toarray(), parallel.edge_graph.toarray())
