"""Small local web app for exploring WIPER1 and WIPER2 edge rankings."""

from __future__ import annotations

import argparse
import json
import math
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib import resources
from io import StringIO
from pathlib import PurePosixPath
from typing import Any

import numpy as np
import pandas as pd

from .io import build_adjacency, normalize_interactions
from .pathflow import path_usage_matrix
from .pipeline import WiperResult, run_wiper1, run_wiper2
from .stats import competition_rank_desc


def _splitter(first_line: str) -> str:
    if "\t" in first_line:
        return "\t"
    if "," in first_line:
        return ","
    return r"\s+"


def _looks_like_header(fields: list[str]) -> bool:
    if len(fields) < 3:
        return False
    try:
        float(fields[2])
    except ValueError:
        return True
    return False


def read_interactions_text(text: str) -> pd.DataFrame:
    """Read an edge list pasted into the web app."""
    lines = [
        line.strip()
        for line in text.splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]
    if not lines:
        raise ValueError("Provide at least one edge with source, target, and weight.")
    sep = _splitter(lines[0])
    fields = lines[0].split("\t" if sep == "\t" else "," if sep == "," else None)
    header = 0 if _looks_like_header(fields) else None
    frame = pd.read_csv(StringIO("\n".join(lines)), sep=sep, header=header, engine="python")
    return normalize_interactions(frame)


def _key(a: str, b: str) -> str:
    aa, bb = (a, b) if a <= b else (b, a)
    return f"{aa}\t{bb}"


def _clean(value: Any) -> Any:
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating, float)):
        value = float(value)
        return value if math.isfinite(value) else None
    if isinstance(value, (np.bool_, bool)):
        return bool(value)
    if pd.isna(value):
        return None
    return value


def _result_map(result: WiperResult) -> dict[str, dict[str, Any]]:
    frame = result.to_frame()
    n = result.iterations
    out: dict[str, dict[str, Any]] = {}
    for row in frame.to_dict(orient="records"):
        out[_key(str(row["nodeA"]), str(row["nodeB"]))] = {
            "degree": _clean(row["Degree"]),
            "w0": _clean(row["W[0]"]),
            "ufc0": _clean(row["UFC[0]"]),
            "logUfc0": _clean(row["logUFC[0]"]),
            "rank0": _clean(row["UFC[0] rank"]),
            "pvalue0": _clean(row["p-value[0]"]),
            "significance0": _clean(row["significance[0]"]),
            "score": _clean(row[f"UFC[{n}]"]),
            "weight": _clean(row[f"W[{n}]"]),
            "logScore": _clean(row[f"logUFC[{n}]"]),
            "rank": _clean(row[f"UFC[{n}] Rank"]),
            "pvalue": _clean(row[f"p-value[{n}]"]),
            "significance": _clean(row[f"significance[{n}]"]),
            "extended": row["extended"] == "Yes",
        }
    return out


def _pathflow_debug(edge_df: pd.DataFrame) -> dict[str, dict[str, Any]]:
    nodes, adj = build_adjacency(edge_df)
    matrices = path_usage_matrix(adj, nodes=nodes)
    out: dict[str, dict[str, Any]] = {}
    degree = np.asarray(matrices.edge_graph.getnnz(axis=1), dtype=np.int64)
    for idx, (a, b) in enumerate(zip(matrices.edges.node_a, matrices.edges.node_b)):
        out[_key(a, b)] = {
            "pathLoad": _clean(matrices.path_load[idx]),
            "coPathDegree": int(degree[idx]),
            "pairCount": int(matrices.pair_count),
        }
    return out


def _winner_node_scores(
    edge_df: pd.DataFrame,
    *,
    iterations: int,
    sigma: float = 0.85,
) -> list[dict[str, Any]]:
    nodes, adj = build_adjacency(edge_df)
    degree = np.count_nonzero(adj > 0, axis=1).astype(np.int64)
    weighted_degree = adj.sum(axis=1).astype(np.float64)
    score0 = np.zeros(len(nodes), dtype=np.float64)
    valid = degree > 0
    score0[valid] = (weighted_degree[valid] ** 2) / degree[valid]
    row_sum = adj.sum(axis=1).astype(np.float64)
    transition = np.zeros_like(adj)
    nonzero = row_sum > 0
    transition[nonzero] = adj[nonzero] / row_sum[nonzero, None]
    score = score0.copy()
    restart = (1.0 - sigma) * score0
    for _ in range(iterations):
        score = restart + sigma * (transition.T @ score)
    positive = score[score > 0]
    median = float(np.median(positive)) if positive.size else 1.0
    winner = np.divide(score, median, out=np.zeros_like(score), where=median > 0)
    ranks = competition_rank_desc(winner)
    return [
        {
            "id": node,
            "degree": int(degree[idx]),
            "weightedDegree": _clean(weighted_degree[idx]),
            "winner0": _clean(score0[idx]),
            "winner": _clean(winner[idx]),
            "logWinner": _clean(np.log2(winner[idx]) if winner[idx] > 0 else np.nan),
            "rank": int(ranks[idx]),
        }
        for idx, node in enumerate(nodes)
    ]


def analyze_edges_text(
    text: str,
    *,
    iterations: int = 80,
    include_novel: bool = False,
    device: str = "cpu",
) -> dict[str, Any]:
    """Score a pasted edge list with WIPER1 and WIPER2."""
    edge_df = read_interactions_text(text)
    if edge_df.empty:
        raise ValueError("No valid non-self edges were found.")

    wiper1 = run_wiper1(edge_df, iterations=iterations, include_novel=include_novel, device=device)
    wiper2 = run_wiper2(edge_df, iterations=iterations, device=device)
    map1 = _result_map(wiper1)
    map2 = _result_map(wiper2)
    path_debug = _pathflow_debug(edge_df)

    node_scores = _winner_node_scores(edge_df, iterations=iterations)
    raw_rank = edge_df["weight"].rank(method="min", ascending=False).astype(int).to_numpy()
    raw: dict[str, dict[str, Any]] = {}
    nodes: set[str] = set()
    for idx, row in enumerate(edge_df.itertuples(index=False)):
        k = _key(row.node_a, row.node_b)
        raw[k] = {"weight": float(row.weight), "rank": int(raw_rank[idx])}
        nodes.update([row.node_a, row.node_b])
    for k in set(map1) | set(map2):
        a, b = k.split("\t")
        nodes.update([a, b])

    edges: list[dict[str, Any]] = []
    for k in sorted(set(raw) | set(map1) | set(map2)):
        a, b = k.split("\t")
        m1 = map1.get(k)
        m2 = map2.get(k)
        debug = path_debug.get(k, {})
        if m2 is not None:
            m2 = {**m2, **debug}
        edges.append(
            {
                "id": k,
                "source": a,
                "target": b,
                "rawWeight": raw.get(k, {}).get("weight"),
                "rawRank": raw.get(k, {}).get("rank"),
                "isInput": k in raw,
                "extended": bool(m1 and m1.get("extended")),
                "wiper1": m1,
                "wiper2": m2,
            }
        )

    return {
        "nodes": sorted(node_scores, key=lambda item: item["id"]),
        "edges": edges,
        "summary": {
            "nodeCount": len(nodes),
            "inputEdgeCount": len(edge_df),
            "edgeCount": len(edges),
            "iterations": iterations,
            "includeNovel": include_novel,
        },
    }


class WiperWebHandler(BaseHTTPRequestHandler):
    server_version = "WiperWeb/0.1"

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        return

    def _send(self, status: HTTPStatus, body: bytes, content_type: str) -> None:
        self.send_response(int(status))
        self.send_header("Content-Type", content_type)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self._send(status, body, "application/json; charset=utf-8")

    def do_GET(self) -> None:  # noqa: N802
        path = PurePosixPath(self.path.split("?", 1)[0])
        name = "index.html" if str(path) in {"/", "/index.html"} else path.name
        if name not in {"index.html", "app.js", "styles.css"}:
            self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        content_type = {
            ".html": "text/html; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
        }.get(path.suffix or ".html", "application/octet-stream")
        data = resources.files("wiper").joinpath("web", name).read_bytes()
        self._send(HTTPStatus.OK, data, content_type)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._send(HTTPStatus.NO_CONTENT, b"", "text/plain; charset=utf-8")

    def do_POST(self) -> None:  # noqa: N802
        if self.path.split("?", 1)[0] != "/api/analyze":
            self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        size = int(self.headers.get("Content-Length", "0"))
        try:
            payload = json.loads(self.rfile.read(size).decode("utf-8"))
            result = analyze_edges_text(
                str(payload.get("text", "")),
                iterations=int(payload.get("iterations", 80)),
                include_novel=bool(payload.get("includeNovel", False)),
                device=str(payload.get("device", "cpu")),
            )
        except Exception as exc:  # pragma: no cover - exercised by browser
            self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
            return
        self._json(HTTPStatus.OK, result)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the local WIPER web explorer")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host")
    parser.add_argument("--port", type=int, default=8765, help="Bind port")
    args = parser.parse_args(argv)

    server = ThreadingHTTPServer((args.host, args.port), WiperWebHandler)
    print(f"Serving WIPER web explorer at http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        return 130
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
