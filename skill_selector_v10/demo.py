#!/usr/bin/env python3
"""
V10 Demo — Quick inspection of SmartSelectorV10 selections.

Run this locally (requires SSH access to server1).
"""

import sys
import os

# Add parent dir to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from skill_selector_v10 import SmartSelectorV10, V10Config
from skill_selector_v10.tools import discover_skills


def main():
    print("=" * 70)
    print("  SmartSelectorV10 Demo")
    print("=" * 70)

    # Load selector
    selector = SmartSelectorV10(verbose=True)
    selector.load(remote=True)

    print(f"\nLoaded {len(selector.data.baselines)} baselines")
    print(f"Found {len(selector.data.task_types)} task types")
    print(f"P1 direct observations: {len(selector.data.target_lookup)}")
    print(f"P2 nearest neighbors: {len(selector.data.nearest_neighbor)}")
    print(f"P3 source qualities: {len(selector.data.source_quality)}")

    # Discover available skills
    available = discover_skills()

    # Example: select for a few targets
    targets = ["da-25-1", "da-8-3", "da-9-1", "da-24-3", "da-15-7"]
    print(f"\n{'Target':<12} {'Source':<18} {'Score':<8} {'BL':<6} {'Tier':<12} {'Type':<25}")
    print("-" * 85)
    for target in targets:
        source, score = selector.select_skill(target, available)
        bl = selector.data.baselines.get(target, 0.5)
        typ = selector.data.task_types.get(target, "?")
        if source:
            tier, bonus, thresh = selector._compatibility_info(source, target)
            src_type = selector.data.task_types.get(source, "?")
            source_str = f"{source}({src_type})"
            score_str = f"{score:+.4f}"
        else:
            tier = "NONE"
            source_str = "(none)"
            score_str = "N/A"
        print(f"{target:<12} {source_str:<18} {score_str:<8} {bl:.3f}  {tier:<12} {typ:<25}")

    # Summary
    print(f"\nAll V10 selections:")
    results = selector.select_all(available)
    selected = sum(1 for s, _ in results.values() if s)
    print(f"  {selected}/{len(results)} targets get a recommendation")


if __name__ == "__main__":
    main()