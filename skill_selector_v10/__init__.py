"""
SmartSelectorV10 — SOTA Skill Selector for BioDSBench Transfer Learning.

A self-contained, standalone package. No dependency on V9/V8 inheritance chain.
"""

from .config import V10Config
from .compatibility import Compatibility, COMPATIBILITY_GROUPS
from .data import DataLoader
from .selector import SmartSelectorV10

__all__ = [
    "V10Config",
    "Compatibility",
    "COMPATIBILITY_GROUPS",
    "DataLoader",
    "SmartSelectorV10",
]