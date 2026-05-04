# WIPER

WIPER is a Python implementation of **Weighted In-Path Edge Ranking** for
ranking biomolecular associations in weighted networks.

This repository mirrors the layout of
[`aimed-lab/WINNER`](https://github.com/aimed-lab/WINNER): the installable
Python package lives in [`python/`](python/), with root-level project notes and
release history here.

The implementation follows:

- Yue Z, Nguyen T, Zhang E, Zhang J, Chen JY. WIPER: Weighted In-Path Edge
  Ranking for biomolecular association networks. *Quantitative Biology*.
  2019;7(4):313-326. doi:10.1007/s40484-019-0180-y
- Local WIPER manuscript, presentation, poster, and historical result files
  used as implementation guidance.

## Quick Start

```bash
pip install ./python

wiper --interactions interactions.tsv -o wiper_edges.tsv \
      --sigma 0.2 --iterations 200 --device auto --n-jobs -1 --include-novel

wiper-web
```

Input is a tab-delimited edge list. The first two columns are endpoint names;
the third column is an edge weight. Weights are coerced to numeric values and
clipped to `[0, 1]`.

The output includes WIPER scores at initialization and after the requested
iteration count, UFC/logUFC scores, p-values, significance symbols, ranks, and
an `extended` flag for inferred novel edges.

## Python API

```python
from wiper import read_interactions, run_wiper1, run_wiper2

interactions = read_interactions("interactions.tsv")
result = run_wiper1(interactions, sigma=0.2, iterations=200, include_novel=True)
result.to_frame().to_csv("wiper_edges.tsv", sep="\t", index=False)

# Path-aware WIPER2 variant:
path_result = run_wiper2(interactions, sigma=0.85, iterations=200)
```

See [`python/README.md`](python/README.md) for implementation details,
performance notes, and test commands.

## Algorithm Variants

`run_wiper1` preserves the published WIPER idea: compute an optimal-path
node matrix `D`, transform endpoint distances into an edge-to-edge matrix `X`,
then diffuse scores on `X`.

`run_wiper2` is a path-aware variant: compute which shortest weighted
paths actually traverse each edge, build a sparse edge-by-node-pair credit
matrix `WP`, construct an edge co-path graph `WP @ WP.T`, and run
WINNER-style restart propagation over that edge graph. This is often the more
direct model if the scientific question is "which associations carry optimal
network flow?"

WIPER2 is free for non-commercial research, education, evaluation, and
academic use. Commercial use requires a separate written license granted by
Dr. Jake Chen or another authorized copyright holder. See
[`LICENSE-WIPER2-NONCOMMERCIAL.md`](LICENSE-WIPER2-NONCOMMERCIAL.md).

The web explorer (`wiper-web`) runs a local browser-facing tool for loading or
generating small networks, toggling raw/WIPER1/WIPER2 edge scores, inspecting
rank tables, and trimming the plot to a top-N or top-percent backbone.
