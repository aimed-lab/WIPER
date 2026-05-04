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
      --iterations 200 --device auto

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
