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

wiper --algorithm pathflow --interactions input.tsv -o path_edges.tsv \
      --iterations 200 --device auto
```

The input may have a header or no header. The first two columns are node names;
the third column is the edge weight. Duplicate undirected edges are collapsed
with the last-seen weight.

## Algorithm Notes

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

## Path-Aware Variant

The CLI option `--algorithm pathflow` and Python function `run_path_wiper`
implement a more literal shortest-path edge-flow model:

1. Find all-pairs optimal weighted paths using `-log(weight)` costs.
2. Split tied shortest paths exactly up to `--max-paths-per-pair`.
3. Allocate each node-pair path's credit to the traversed edges by relative
   edge strength, producing `WP`.
4. Build the edge graph as `WP @ WP.T`.
5. Run WINNER-style restart propagation on that edge graph.

This variant does not infer novel edges because it ranks observed edges by
their actual use in optimal paths.

## Test

```bash
pytest
python -m build
```
