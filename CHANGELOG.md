# Changelog

## 0.1.0 - 2026-05-02

- Initial Python implementation of WIPER.
- Adds paper-faithful edge ranking, p-values, novel-edge inference, CLI, tests,
  CPU sparse/chunked execution, and optional PyTorch device dispatch.
- Adds a path-aware WIPER variant that builds a shortest-path edge-credit
  matrix and runs WINNER-style restart propagation on the resulting edge graph.
