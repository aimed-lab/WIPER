"""Benchmark WIPER2 CPU parallelism and optional GPU restart propagation."""

from __future__ import annotations

import argparse
import os
import platform
import time
from dataclasses import dataclass

import numpy as np
import pandas as pd

from wiper.backend import available_devices, resolve_device
from wiper.io import build_adjacency, normalize_interactions
from wiper.pathflow import path_usage_matrix, winner_initial_score, winner_restart_iteration
from wiper.pipeline import run_wiper2


@dataclass(frozen=True)
class Timing:
    label: str
    seconds: float


def make_scale_free_edges(nodes: int, edges: int, *, seed: int = 42) -> pd.DataFrame:
    """Create a deterministic weighted scale-free-ish undirected network."""
    if nodes < 3:
        raise ValueError("nodes must be >= 3")
    if edges < nodes - 1:
        raise ValueError("edges must be at least nodes - 1")
    max_edges = nodes * (nodes - 1) // 2
    if edges > max_edges:
        raise ValueError("edges exceeds complete graph size")

    rng = np.random.default_rng(seed)
    edge_set: set[tuple[int, int]] = set()
    degree = np.ones(nodes, dtype=np.float64)

    for node in range(1, nodes):
        probs = degree[:node] / degree[:node].sum()
        target = int(rng.choice(node, p=probs))
        a, b = sorted((node, target))
        edge_set.add((a, b))
        degree[node] += 1
        degree[target] += 1

    while len(edge_set) < edges:
        probs = degree / degree.sum()
        a = int(rng.choice(nodes, p=probs))
        b = int(rng.choice(nodes, p=probs))
        if a == b:
            continue
        i, j = sorted((a, b))
        if (i, j) in edge_set:
            continue
        edge_set.add((i, j))
        degree[i] += 1
        degree[j] += 1

    rows = []
    for i, j in sorted(edge_set):
        rows.append((f"N{i}", f"N{j}", float(rng.uniform(0.35, 0.99))))
    return pd.DataFrame(rows, columns=["node_a", "node_b", "weight"])


def best_of(fn, *, repeat: int) -> float:
    times = []
    for _ in range(repeat):
        start = time.perf_counter()
        fn()
        times.append(time.perf_counter() - start)
    return min(times)


def benchmark(args: argparse.Namespace) -> list[Timing]:
    df = make_scale_free_edges(args.nodes, args.edges, seed=args.seed)
    edge_df = normalize_interactions(df)
    nodes, adj = build_adjacency(edge_df)
    timings: list[Timing] = []

    print(f"hardware: {platform.platform()}")
    print(f"python: {platform.python_version()}")
    print(f"cpu_count: {os.cpu_count()}")
    print(f"devices: {', '.join(available_devices())}")
    print(f"network: nodes={len(nodes)} edges={len(edge_df)} iterations={args.iterations}")
    print("")

    serial_matrices = None
    for jobs in args.jobs:
        def run_matrix():
            return path_usage_matrix(
                adj,
                nodes=nodes,
                n_jobs=jobs,
                source_chunk_size=args.source_chunk_size,
                max_paths_per_pair=args.max_paths_per_pair,
            )

        seconds = best_of(run_matrix, repeat=args.repeat)
        timings.append(Timing(f"path matrix n_jobs={jobs}", seconds))
        print(f"path matrix n_jobs={jobs}\t{seconds:.4f}s")
        if serial_matrices is None:
            serial_matrices = run_matrix()

    assert serial_matrices is not None
    w0 = winner_initial_score(serial_matrices.edge_graph, serial_matrices.path_load)
    for device in args.devices:
        resolved = resolve_device(device)

        def run_iteration():
            winner_restart_iteration(
                serial_matrices.edge_graph,
                w0,
                iterations=args.iterations,
                sigma=args.sigma,
                device=device,
            )

        seconds = best_of(run_iteration, repeat=args.repeat)
        timings.append(Timing(f"restart device={device} resolved={resolved}", seconds))
        print(f"restart device={device} resolved={resolved}\t{seconds:.4f}s")

    for jobs in args.jobs:
        def run_full():
            run_wiper2(
                edge_df,
                iterations=args.iterations,
                sigma=args.sigma,
                device=args.full_device,
                n_jobs=jobs,
                source_chunk_size=args.source_chunk_size,
                max_paths_per_pair=args.max_paths_per_pair,
            )

        seconds = best_of(run_full, repeat=args.repeat)
        timings.append(Timing(f"full run n_jobs={jobs} device={args.full_device}", seconds))
        print(f"full run n_jobs={jobs} device={args.full_device}\t{seconds:.4f}s")

    return timings


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--nodes", type=int, default=120)
    parser.add_argument("--edges", type=int, default=360)
    parser.add_argument("--iterations", type=int, default=200)
    parser.add_argument("--sigma", type=float, default=0.85)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--repeat", type=int, default=3)
    parser.add_argument("--jobs", type=int, nargs="+", default=[1, 2, 4, -1])
    parser.add_argument("--devices", nargs="+", default=["cpu", "auto"])
    parser.add_argument("--full-device", default="cpu", choices=["auto", "cpu", "cuda", "mps"])
    parser.add_argument("--source-chunk-size", type=int, default=None)
    parser.add_argument("--max-paths-per-pair", type=int, default=1024)
    return parser.parse_args()


def main() -> int:
    benchmark(parse_args())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
