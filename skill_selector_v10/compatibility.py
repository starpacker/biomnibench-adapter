"""
Compatibility groups and task type utilities for BioDSBench tasks.

Defines which task types can transfer skills to which other task types.
"""

from typing import Dict, Optional, Set, Tuple


# Compatibility groups: task_types within the same group share transferable skills.
# These groups capture our empirical finding that same-type transfers are highly
# reliable (76% positive) while cross-type transfers within a compatible group
# are hit-or-miss (50% positive).
COMPATIBILITY_GROUPS: list[Set[str]] = [
    {"differential-expression", "chromatin-profiling", "pathway-enrichment"},
    {"association-testing", "gwas-eqtl"},
    {"cell-composition", "cell-cell-communication"},
    {"clustering", "cell-composition"},
    {"predictive-modeling", "survival-analysis", "longitudinal-analysis"},
    {"co-expression-networks", "multi-omic-integration", "cross-cohort-comparison"},
    {"mutation-analysis", "tcr-repertoire"},
]


def _build_type_compatibility_lookup() -> Dict[str, Set[str]]:
    """Build a lookup: task_type -> set of compatible task_types."""
    lookup = {}
    for group in COMPATIBILITY_GROUPS:
        for t in group:
            lookup[t] = group
    return lookup


TYPE_COMPATIBILITY = _build_type_compatibility_lookup()


class Compatibility:
    """Utility for checking task type compatibility between source and target."""

    @staticmethod
    def get_task_type(task_id: str, task_types: Dict[str, str]) -> Optional[str]:
        """Get the task_type for a given task ID."""
        return task_types.get(task_id)

    @staticmethod
    def get_compatibility_info(
        source_task: str,
        target_task: str,
        task_types: Dict[str, str],
        cfg=None,
    ) -> Tuple[str, float, float]:
        """Returns (compatibility_tier, bonus, threshold).

        Args:
            source_task: Source task ID.
            target_task: Target task ID.
            task_types: Dict mapping task_id -> task_type string.
            cfg: Optional config with bonus/threshold values. Uses defaults if None.

        Returns:
            Tuple of (tier, bonus, threshold).
            tier: 'same', 'compatible', 'incompatible', or 'unknown'
        """
        # Avoid circular import
        from .config import V10Config

        if cfg is None:
            cfg = V10Config()

        src_type = task_types.get(source_task)
        tgt_type = task_types.get(target_task)

        if not src_type or not tgt_type:
            return "unknown", 0.0, cfg.compatible_threshold

        if src_type == tgt_type:
            return "same", cfg.same_type_bonus, cfg.same_type_threshold

        src_group = TYPE_COMPATIBILITY.get(src_type, {src_type})
        if tgt_type in src_group:
            return "compatible", cfg.compatible_bonus, cfg.compatible_threshold

        return "incompatible", cfg.incompatible_penalty, float("inf")  # never passes

    @staticmethod
    def describe(source_task: str, target_task: str, task_types: Dict[str, str]) -> str:
        """Human-readable description of compatibility."""
        src_type = task_types.get(source_task, "?")
        tgt_type = task_types.get(target_task, "?")
        tier, bonus, threshold = Compatibility.get_compatibility_info(
            source_task, target_task, task_types
        )
        return (
            f"{source_task}({src_type}) -> {target_task}({tgt_type}): "
            f"tier={tier}, bonus={bonus:+.2f}, threshold={threshold:.2f}"
        )