"""Command-line interface for WIPER."""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from . import __version__
from .backend import available_devices
from .io import read_interactions, write_wiper_result
from .pipeline import run_path_wiper, run_wiper


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="WIPER weighted in-path edge ranking")
    parser.add_argument("--interactions", required=True, type=Path, help="Tab-delimited edge list")
    parser.add_argument("-o", "--output", required=True, type=Path, help="Output TSV path")
    parser.add_argument(
        "--sigma",
        type=float,
        default=None,
        help="Damping factor (default: 0.2 for paper, 0.85 for pathflow)",
    )
    parser.add_argument("--iterations", type=int, default=200, help="WIPER iterations (default: 200)")
    parser.add_argument(
        "--algorithm",
        choices=["paper", "pathflow"],
        default="paper",
        help="Ranking algorithm: paper-faithful WIPER or path-aware corrected variant",
    )
    parser.add_argument(
        "--include-novel",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Infer novel edges from D-matrix candidates (default: true)",
    )
    parser.add_argument(
        "--max-hops",
        type=int,
        default=None,
        help="Optional max endpoint-bridge hop distance for X edges",
    )
    parser.add_argument(
        "--confidence-cutoff",
        type=float,
        default=0.0,
        help="Drop X entries at or below this score",
    )
    parser.add_argument(
        "--device",
        choices=["auto", "cpu", "cuda", "mps"],
        default="auto",
        help="Computation device for WIPER iteration",
    )
    parser.add_argument("--n-jobs", type=int, default=-1, help="CPU workers for X construction")
    parser.add_argument("--chunk-size", type=int, default=1000, help="Rows per X construction chunk")
    parser.add_argument(
        "--pair-weight",
        choices=["uniform", "path_strength"],
        default="uniform",
        help="Pathflow only: credit each node pair equally or by optimal path strength",
    )
    parser.add_argument(
        "--share-mode",
        choices=["strength", "cost"],
        default="strength",
        help="Pathflow only: allocate path credit by original edge strength or path cost",
    )
    parser.add_argument(
        "--initial-score",
        choices=["winner", "path_load"],
        default="winner",
        help="Pathflow only: WINNER edge-graph initial score or raw path load",
    )
    parser.add_argument(
        "--max-paths-per-pair",
        type=int,
        default=1024,
        help="Pathflow only: maximum tied shortest paths to split exactly",
    )
    parser.add_argument("--list-devices", action="store_true", help="Print available devices and exit")
    parser.add_argument("--version", action="version", version=f"wiper-net {__version__}")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.list_devices:
        print(", ".join(available_devices()))
        return 0

    t0 = time.perf_counter()
    interactions = read_interactions(args.interactions)
    if args.algorithm == "pathflow":
        sigma = 0.85 if args.sigma is None else args.sigma
        result = run_path_wiper(
            interactions,
            sigma=sigma,
            iterations=args.iterations,
            pair_weight=args.pair_weight,
            share_mode=args.share_mode,
            initial_score=args.initial_score,
            max_paths_per_pair=args.max_paths_per_pair,
            device=args.device,
        )
    else:
        sigma = 0.2 if args.sigma is None else args.sigma
        result = run_wiper(
            interactions,
            sigma=sigma,
            iterations=args.iterations,
            include_novel=args.include_novel,
            max_hops=args.max_hops,
            confidence_cutoff=args.confidence_cutoff,
            device=args.device,
            n_jobs=args.n_jobs,
            chunk_size=args.chunk_size,
        )
    frame = result.to_frame()
    write_wiper_result(args.output, frame)
    dt = time.perf_counter() - t0
    print(f"wrote {args.output} ({len(frame)} edges) in {dt:.2f}s", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
