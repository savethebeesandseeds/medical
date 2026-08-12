#!/usr/bin/env python3
"""Summarize functional-capacity sensitivity without making clinical claims."""

from __future__ import annotations

import argparse
import csv
import glob
import json
from collections import Counter, defaultdict
from pathlib import Path


PHYSICAL_FAILURES = {"capacity_limited", "reserve_too_high"}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-glob", action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    paths = sorted({
        Path(path)
        for pattern in args.input_glob
        for path in glob.glob(pattern)
    })
    if not paths:
        raise FileNotFoundError(f"No capacity shards matched {args.input_glob}")
    rows: list[dict[str, str]] = []
    for path in paths:
        with path.open(encoding="utf-8", newline="") as handle:
            rows.extend(csv.DictReader(handle))

    by_scale_target: dict[tuple[float, str], Counter] = defaultdict(Counter)
    by_pose_scale: dict[tuple[str, float], dict[str, str]] = defaultdict(dict)
    for row in rows:
        scale = float(row["capacity_scale"])
        target = row["capacity_target"]
        status = row["status"]
        if row["usable"] == "1":
            outcome = "modeled_able"
        elif status in PHYSICAL_FAILURES:
            outcome = "modeled_unable"
        else:
            outcome = "ambiguous_solver_failure"
        by_scale_target[(scale, target)][outcome] += 1
        source_pose = row["sample_id"].split("@@", 1)[0]
        by_pose_scale[(source_pose, scale)][target] = outcome

    summaries = []
    for (scale, target), counts in sorted(by_scale_target.items()):
        summaries.append(
            {
                "capacity_scale": scale,
                "target": target,
                "modeled_able": counts["modeled_able"],
                "modeled_unable": counts["modeled_unable"],
                "ambiguous_solver_failure": counts["ambiguous_solver_failure"],
            }
        )

    separation_by_scale = []
    scales = sorted({float(row["capacity_scale"]) for row in rows})
    targets = sorted({row["capacity_target"] for row in rows})
    for scale in scales:
        poses = sorted({pose for pose, row_scale in by_pose_scale if row_scale == scale})
        signatures = {
            target: [by_pose_scale[(pose, scale)].get(target, "ambiguous_solver_failure") for pose in poses]
            for target in targets
        }
        unresolved = []
        minimum_distance = None
        for left_index, left in enumerate(targets):
            for right in targets[left_index + 1 :]:
                distance = sum(
                    one != two
                    for one, two in zip(signatures[left], signatures[right])
                    if "ambiguous" not in one and "ambiguous" not in two
                )
                minimum_distance = distance if minimum_distance is None else min(minimum_distance, distance)
                if distance == 0:
                    unresolved.append([left, right])
        separation_by_scale.append(
            {
                "capacity_scale": scale,
                "posture_count": len(poses),
                "minimum_pairwise_outcome_distance": minimum_distance or 0,
                "indistinguishable_pair_count": len(unresolved),
                "indistinguishable_pairs": unresolved,
            }
        )

    monotonicity_violations = []
    source_poses = sorted({pose for pose, _ in by_pose_scale})
    for pose in source_poses:
        for target in targets:
            known = [
                (scale, by_pose_scale[(pose, scale)].get(target, "ambiguous_solver_failure"))
                for scale in scales
            ]
            for lower_index, (lower_scale, lower_outcome) in enumerate(known):
                if lower_outcome != "modeled_able":
                    continue
                for higher_scale, higher_outcome in known[lower_index + 1 :]:
                    if higher_outcome == "modeled_unable":
                        monotonicity_violations.append(
                            {
                                "source_pose": pose,
                                "target": target,
                                "lower_capacity_scale": lower_scale,
                                "lower_outcome": lower_outcome,
                                "higher_capacity_scale": higher_scale,
                                "higher_outcome": higher_outcome,
                            }
                        )

    report = {
        "schema_version": 1,
        "interpretation": "Generic-model capacity-reduction sensitivity under gravity only. Modeled outcomes are not patient ability, pain, injury, or diagnosis.",
        "case_count": len(rows),
        "status_counts": dict(Counter(row["status"] for row in rows)),
        "target_scale_summary": summaries,
        "separation_by_scale": separation_by_scale,
        "monotonicity_violation_count": len(monotonicity_violations),
        "monotonicity_violations": monotonicity_violations,
        "failure_definition": {
            "modeled_unable": sorted(PHYSICAL_FAILURES),
            "ambiguous": "optimizer or numerical failure",
            "modeled_able": "passed the same exact equilibrium and reserve gates as the live static solver",
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": "ok", "report": str(args.output), "cases": len(rows)}))


if __name__ == "__main__":
    main()
