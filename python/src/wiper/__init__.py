"""WIPER: weighted in-path edge ranking."""

from __future__ import annotations

from .backend import available_devices, resolve_device
from .core import (
    ant_colony_iteration,
    build_edge_network,
    infer_novel_edges,
    initial_edge_scores,
    optimal_path_matrix,
)
from .io import build_adjacency, normalize_interactions, read_interactions, write_wiper_result
from .pathflow import path_usage_matrix, winner_restart_iteration
from .pipeline import WiperResult, devices_report, run_path_wiper, run_wiper

__version__ = "0.1.0"

__all__ = [
    "__version__",
    "WiperResult",
    "ant_colony_iteration",
    "available_devices",
    "build_adjacency",
    "build_edge_network",
    "devices_report",
    "infer_novel_edges",
    "initial_edge_scores",
    "normalize_interactions",
    "optimal_path_matrix",
    "path_usage_matrix",
    "read_interactions",
    "resolve_device",
    "run_path_wiper",
    "run_wiper",
    "winner_restart_iteration",
    "write_wiper_result",
]
