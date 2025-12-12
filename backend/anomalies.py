from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class Stat:
    n: int
    mean: float
    stdev: float


def compute_stat(values: list[float]) -> Stat:
    n = len(values)
    if n == 0:
        return Stat(n=0, mean=0.0, stdev=0.0)
    mean = sum(values) / n
    if n < 2:
        return Stat(n=n, mean=mean, stdev=0.0)
    var = sum((x - mean) ** 2 for x in values) / (n - 1)
    stdev = math.sqrt(var)
    return Stat(n=n, mean=mean, stdev=stdev)


def zscore(value: float, stat: Stat) -> float | None:
    if stat.n < 2 or stat.stdev <= 0:
        return None
    return (value - stat.mean) / stat.stdev
