# WIPER Python

This package implements Weighted In-Path Edge Ranking as an installable Python
tool with a CLI and Python API.

## Install

```bash
pip install .
pip install ".[gpu]"   # optional PyTorch device support
```

## CLI

```bash
wiper --interactions input.tsv -o edges.tsv \
      --sigma 0.2 --iterations 200 \
      --device auto --n-jobs -1 --include-novel

wiper --algorithm wiper2 --interactions input.tsv -o path_edges.tsv \
      --iterations 200 --device auto --n-jobs -1

wiper-web --host 127.0.0.1 --port 8765
```

The input may have a header or no header. The first two columns are node names;
the third column is the edge weight. Duplicate undirected edges are collapsed
with the last-seen weight.

## WIPER1 Algorithm Notes

1. Build weighted undirected `G`.
2. Compute the optimal-path matrix `D` with shortest paths on `-log(G)`.
3. Optionally infer novel edges from high-scoring non-input pairs in `D`.
4. Build the sparse edge-to-edge traversal matrix `X` in chunks.
5. Initialize `W0 = sum(X_neighbors)^2 / degree`.
6. Iterate ant-colony information flow over row-normalized `X`.
7. Normalize scores to UFC/logUFC and estimate p-values from the score
   distribution.

The default edge-to-edge network can be `O(E^2)`. Use `--chunk-size`,
`--confidence-cutoff`, and `--max-hops` to bound memory and runtime on large
networks.

## WIPER2 Path-Aware Variant

The CLI option `--algorithm wiper2` and Python function `run_wiper2` implement
a more literal shortest-path edge-flow model:

1. Find all-pairs optimal weighted paths using `-log(weight)` costs.
2. Split tied shortest paths exactly up to `--max-paths-per-pair`.
3. Allocate each node-pair path's credit to the traversed edges by relative
   edge strength, producing `WP`.
4. Build the edge graph as `WP @ WP.T`.
5. Run WINNER-style restart propagation on that edge graph.

This variant does not infer novel edges because it ranks observed edges by
their actual use in optimal paths.

`--algorithm paper` and `--algorithm pathflow` remain accepted as compatibility
aliases for `wiper1` and `wiper2`.

### WIPER2 Parallelism and GPU Use

WIPER2 has two computational phases:

1. **Path-flow construction** builds the edge-by-node-pair `WP` matrix. This
   is usually the dominant cost. It now runs source-node blocks in parallel
   with joblib process workers when `n_jobs != 1`; use `--n-jobs -1` to use all
   detected CPU cores. If a restricted runtime prevents process pools from
   starting, WIPER2 falls back to a thread backend so the run still completes.
2. **WINNER-style restart propagation** runs sparse matrix-vector iteration
   over the edge co-path graph. CPU always works. If PyTorch is installed and a
   CUDA or Apple MPS backend is available, `--device auto`, `--device cuda`, or
   `--device mps` dispatches this restart phase to GPU. The path-flow
   construction phase remains CPU-parallel because it depends on Dijkstra
   predecessor enumeration and exact tied-path splitting.

Practical interpretation: multi-core CPU parallelism accelerates the expensive
WIPER2 phase; GPU helps only when the edge co-path graph is large enough that
the restart iteration dominates transfer/setup overhead.

#### Local Performance Snapshot

Benchmarked with `python/benchmarks/benchmark_wiper2.py` on an Apple M4 with 10
detected CPU cores, Python 3.13.2, synthetic scale-free weighted networks, 200
restart iterations, and `device=cpu`. The environment reported only `cpu`
because PyTorch/GPU support was not installed, so no CUDA/MPS timing was
available.

| Network | Phase | 1 worker | 2 workers | 4 workers | 10 workers |
|---|---:|---:|---:|---:|---:|
| 120 nodes / 360 edges | Path matrix | 0.1855 s | 0.1279 s | 0.1826 s | 0.0839 s |
| 120 nodes / 360 edges | Full WIPER2 | 0.2111 s | 0.1469 s | 0.1136 s | 0.1122 s |
| 300 nodes / 900 edges | Path matrix | 1.3897 s | 0.8749 s | 0.7095 s | 0.4309 s |
| 300 nodes / 900 edges | Full WIPER2 | 1.3285 s | 0.9818 s | 0.6978 s | 0.5707 s |

For the 300-node benchmark, the full-run CPU speed-up was about 2.3x at 10
workers, while the path-matrix phase alone improved by about 3.2x. Scaling is
not perfectly linear because `WP @ WP.T`, result assembly, Python
serialization, and final table generation remain shared overhead.

WIPER2 is free for non-commercial research, education, evaluation, and
academic use. Commercial use requires a separate written license granted by
Dr. Jake Chen or another authorized copyright holder. See
[`LICENSE-WIPER2-NONCOMMERCIAL.md`](LICENSE-WIPER2-NONCOMMERCIAL.md).

## Web Explorer

`wiper-web` serves a local app with file/paste loading, random small-network
generation, raw/WIPER1/WIPER2 plot modes, edge-linked rank tables, and backbone
filtering by top N or top percent.

## Test

```bash
pytest
python -m pip wheel . --no-deps
```
