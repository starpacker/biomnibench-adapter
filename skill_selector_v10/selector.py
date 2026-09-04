"""
SmartSelectorV10 — SOTA Skill Selector with Tiered Thresholds.

A self-contained implementation (no inheritance from V9/V8).

Key insight from 23 validation experiments:
- Same-type transfers: 76% positive, 94% non-negative → very permissive threshold
- Compatible cross-type: 50% positive → moderate threshold, depends on source quality
- Incompatible: empirically 0% positive → hard reject

Three-phase selection:
- P1: Direct observation (GT-verified truth) — exempt from thresholds
- P2: Nearest neighbor — find similar target with known good source
- P3: v7 fallback — isotonic curve + source quality + compatibility bonus
"""

from typing import Dict, Optional, Tuple

from .compatibility import Compatibility
from .config import DEFAULT_CONFIG, V10Config
from .data import DataLoader


class SmartSelectorV10:
    """V10 Balanced Selector with Tiered Thresholds.

    Usage:
        selector = SmartSelectorV10(verbose=True)
        selector.load()
        source, score = selector.select_skill("da-25-1", available_skills)
    """

    def __init__(self, cfg: Optional[V10Config] = None, verbose: bool = False):
        self.cfg = cfg or DEFAULT_CONFIG
        self.verbose = verbose
        self.data = DataLoader(cfg=self.cfg, verbose=verbose)

    def _log(self, msg: str):
        if self.verbose:
            print(f"[V10] {msg}", flush=True)

    def load(self, remote: bool = True) -> "SmartSelectorV10":
        """Load all data (baselines, similarity, v7 model, task types)."""
        self.data.load_all(remote=remote)
        return self

    # ── Compatibility Info ────────────────────────────────────────────────

    def _compatibility_info(self, source: str, target: str) -> Tuple[str, float, float]:
        """Returns (tier, bonus, threshold)."""
        return Compatibility.get_compatibility_info(
            source, target, self.data.task_types, self.cfg
        )

    # ── Main Selection Logic ──────────────────────────────────────────────

    def select_skill(
        self,
        target: str,
        available_skills: Dict[str, str],
        similarity_matrix: Dict = None,
    ) -> Tuple[Optional[str], float]:
        """Returns (source_task, confidence) or (None, 0.0).

        Strategy:
        - P1: Direct observation (GT-verified) → exempt from all thresholds
        - P2: Nearest neighbor → tiered by task_type compatibility
        - P3: v7 fallback → tiered by task_type compatibility
        - P2→P3 override: best compatible/same-type P3 if P2 fails threshold
        """
        bl = self.data.baselines.get(target, 0.5)

        # Baseline gating
        if bl > self.cfg.bl_max:
            self._log(f"SKIP {target} (bl={bl:.2f} > {self.cfg.bl_max})")
            return None, 0.0

        # ── P1: Direct Observation ────────────────────────────────────────
        if target in self.data.target_lookup:
            b = self.data.target_lookup[target]
            if b["source"] in available_skills:
                tier, bonus, _ = self._compatibility_info(b["source"], target)
                score = b["delta"] + bonus
                self._log(
                    f"P1: {target}->{b['source']} "
                    f"(delta={b['delta']:+.3f}, tier={tier}, bonus={bonus:+.2f})"
                )
                if score > 0:
                    return b["source"], score
                self._log(
                    f"P1 REJECTED: {target}->{b['source']} (score={score:.4f} <= 0)"
                )

        # ── Build P3 Candidates ───────────────────────────────────────────
        fh = self.data.f_hat(bl)
        p3_candidates = []
        for s in available_skills:
            if s == target:
                continue
            raw_score = fh + self.data.source_quality.get(s, 0.0)
            tier, bonus, threshold = self._compatibility_info(s, target)
            adjusted_score = raw_score + bonus
            p3_candidates.append((s, adjusted_score, raw_score, tier, bonus, threshold))

        # Sort: by tier priority (same > compatible > unknown > incompatible),
        # then by adjusted score descending
        tier_order = {"same": 0, "compatible": 1, "unknown": 2, "incompatible": 3}
        p3_candidates.sort(key=lambda x: (tier_order.get(x[3], 99), -x[1]))

        # ── P2: Nearest Neighbor (tiered thresholds) ──────────────────────
        if target in self.data.nearest_neighbor:
            nn = self.data.nearest_neighbor[target]
            if nn["source"] in available_skills and nn["source"] != target:
                tier, bonus, threshold = self._compatibility_info(nn["source"], target)
                p2_score = nn["score"] + bonus
                src_type = self.data.task_types.get(nn["source"], "?")
                tgt_type = self.data.task_types.get(target, "?")

                if p2_score >= threshold:
                    self._log(
                        f"P2: {target}->{nn['source']} "
                        f"({src_type}->{tgt_type}, tier={tier}, "
                        f"score={p2_score:.4f} >= {threshold})"
                    )
                    return nn["source"], p2_score

                # P2 failed → try P2→P3 override
                self._log(
                    f"P2 FAILED: {target}->{nn['source']} "
                    f"(score={p2_score:.4f} < {threshold}, tier={tier})"
                )

                best_override = None
                for s, adj_score, raw, tier2, bonus2, thresh2 in p3_candidates:
                    if thresh2 != float("inf") and adj_score >= thresh2:
                        best_override = (s, adj_score, tier2)
                        break

                if best_override:
                    self._log(
                        f"P2->P3 override: {target} "
                        f"P2={nn['source']}({tier}, {p2_score:.4f}) "
                        f"P3={best_override[0]}({best_override[2]}, {best_override[1]:.4f})"
                    )
                    return best_override[0], best_override[1]

        # ── P3: v7 Fallback ──────────────────────────────────────────────
        if p3_candidates:
            best = p3_candidates[0]
            s, adj_score, raw, tier, bonus, threshold = best
            src_type = self.data.task_types.get(s, "?")
            tgt_type = self.data.task_types.get(target, "?")

            if threshold != float("inf") and adj_score >= threshold:
                self._log(
                    f"P3: {target}->{s} "
                    f"({src_type}->{tgt_type}, tier={tier}, "
                    f"score={adj_score:.4f} >= {threshold})"
                )
                return s, adj_score

            self._log(
                f"P3 REJECTED: {target}->{s} "
                f"(score={adj_score:.4f} < {threshold}, tier={tier})"
            )

        self._log(f"NO RECOMMENDATION: {target}")
        return None, 0.0

    def select_all(
        self, available_skills: Dict[str, str]
    ) -> Dict[str, Tuple[Optional[str], float]]:
        """Run select_skill for all targets that have baselines.

        Returns:
            Dict mapping target_task -> (source, confidence)
        """
        results = {}
        for target in sorted(self.data.baselines.keys()):
            source, score = self.select_skill(target, available_skills)
            results[target] = (source, score)
        return results

    # ── Description ───────────────────────────────────────────────────────

    def get_name(self) -> str:
        return "SmartSelector v10 (Tiered Thresholds)"

    def describe_selection(
        self, target_task: str, selected_source: Optional[str], confidence: float
    ) -> str:
        """Generate a human-readable explanation."""
        if selected_source is None:
            bl = self.data.baselines.get(target_task, 0.5)
            return (
                f"[V10] No suitable skill for {target_task} (bl={bl:.2f}). "
                f"Either baseline too high, incompatible types, or no source meets threshold."
            )
        if selected_source in self.data.task_types and target_task in self.data.task_types:
            tier, bonus, _ = self._compatibility_info(selected_source, target_task)
            return (
                f"[V10] Selected '{selected_source}' ({self.data.task_types[selected_source]}) "
                f"for '{target_task}' ({self.data.task_types[target_task]}) "
                f"[{tier}, score={confidence:.4f}]"
            )
        return (
            f"[V10] Selected '{selected_source}' for '{target_task}' "
            f"(confidence={confidence:.4f})"
        )