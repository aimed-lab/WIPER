"""Device discovery for optional CPU/GPU execution."""

from __future__ import annotations

from typing import Literal

Device = Literal["auto", "cpu", "cuda", "mps"]


def available_devices() -> list[str]:
    """Return devices usable by the optional PyTorch backend."""
    devices = ["cpu"]
    try:
        import torch
    except ImportError:
        return devices

    if torch.cuda.is_available():
        devices.append("cuda")
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        devices.append("mps")
    return devices


def resolve_device(device: Device = "auto") -> str:
    """Resolve a requested device, falling back to CPU when unavailable."""
    if device == "auto":
        devices = available_devices()
        if "cuda" in devices:
            return "cuda"
        if "mps" in devices:
            return "mps"
        return "cpu"
    return device if device in available_devices() else "cpu"

