"""WIPER score normalization, ranks, and p-value estimation."""

from __future__ import annotations

import numpy as np
from scipy.stats import norm


def ufc_scores(score: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Return UFC and log2(UFC) for a score vector."""
    score = np.asarray(score, dtype=np.float64)
    med = float(np.nanmedian(score))
    if not np.isfinite(med) or med <= 0:
        positive = score[score > 0]
        med = float(np.nanmedian(positive)) if positive.size else 1.0
    if med <= 0:
        med = 1.0
    ufc = score / med
    with np.errstate(divide="ignore", invalid="ignore"):
        log_ufc = np.log2(ufc)
    log_ufc = np.nan_to_num(log_ufc, nan=-np.inf, posinf=np.inf, neginf=-np.inf)
    return ufc, log_ufc


def _histogram_mode(values: np.ndarray, iqr: float) -> float:
    if values.size == 0:
        return 0.0
    if iqr <= 0:
        return float(np.median(values))
    width = 0.2 * iqr
    if width <= 0:
        return float(np.median(values))
    lo = float(np.min(values))
    hi = float(np.max(values))
    if lo == hi:
        return lo
    bins = max(1, int(np.ceil((hi - lo) / width)))
    counts, edges = np.histogram(values, bins=bins)
    idx = int(np.argmax(counts))
    return float((edges[idx] + edges[idx + 1]) / 2.0)


def ranking_pvalues(log_ufc: np.ndarray) -> np.ndarray:
    """Estimate WIPER p-values from logUFC distribution.

    This follows the paper's two-branch rule: use a fitted normal distribution
    when the histogram mode and median are close; otherwise use the empirical
    high-score tail.
    """
    values = np.asarray(log_ufc, dtype=np.float64)
    finite = np.isfinite(values)
    out = np.ones(values.shape, dtype=np.float64)
    x = values[finite]
    if x.size == 0:
        return out

    q1, q3 = np.percentile(x, [25, 75])
    iqr = float(q3 - q1)
    med = float(np.median(x))
    mode = _histogram_mode(x, iqr)
    if iqr > 0 and abs(mode - med) <= 0.5 * iqr:
        sd = iqr / 1.34
        if sd > 0:
            p = np.where(x > med, norm.sf(x, loc=med, scale=sd), norm.cdf(x, loc=med, scale=sd))
            out[finite] = np.clip(p, 0.0, 1.0)
            return out

    # Empirical branch from the paper: fraction of edges with a higher logUFC.
    ranks = np.array([(x > xi).sum() / x.size for xi in x], dtype=np.float64)
    out[finite] = ranks
    return out


def significance_symbols(pvalues: np.ndarray) -> np.ndarray:
    """Return legacy WIPER significance symbols."""
    p = np.asarray(pvalues, dtype=np.float64)
    sig = np.full(p.shape, "-", dtype=object)
    sig[p <= 0.05] = "*"
    sig[p <= 0.01] = "**"
    return sig


def competition_rank_desc(values: np.ndarray) -> np.ndarray:
    """Return 1-based descending competition ranks."""
    values = np.asarray(values, dtype=np.float64)
    order = np.argsort(-values, kind="mergesort")
    ranks = np.empty(values.shape[0], dtype=np.int64)
    last_value: float | None = None
    current_rank = 0
    for pos, idx in enumerate(order, start=1):
        val = float(values[idx])
        if last_value is None or val != last_value:
            current_rank = pos
            last_value = val
        ranks[idx] = current_rank
    return ranks

