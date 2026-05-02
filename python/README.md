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

## Test

```bash
pytest
python -m build
```

