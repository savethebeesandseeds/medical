#!/usr/bin/env python3
"""Certify a minimum modeled-capacity outcome panel for detectable targets."""

from __future__ import annotations

import argparse
import csv
import glob
import json
import subprocess
from collections import Counter
from pathlib import Path


PHYSICAL_FAILURES = {"capacity_limited", "reserve_too_high"}
COORDINATES = (
    "elv_angle",
    "shoulder_elv",
    "shoulder_rot",
    "elbow_flexion",
    "pro_sup",
    "deviation",
    "flexion",
)


def expression(indices: list[int]) -> str:
    if not indices:
        return "0"
    chunks = []
    for start in range(0, len(indices), 80):
        chunks.append(" + ".join(f"x{index}" for index in indices[start : start + 80]))
    return "\n  + ".join(chunks)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-glob", action="append", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--capacity-scale", type=float, required=True)
    parser.add_argument("--pair-distance", type=int, required=True)
    parser.add_argument("--exclude-target", action="append", default=[])
    parser.add_argument("--one-per-family", action="store_true")
    parser.add_argument("--baseline-glob", action="append", default=[])
    parser.add_argument("--seconds", type=int, default=300)
    parser.add_argument("--container", default="opensim-muscles")
    args = parser.parse_args()

    paths = sorted({
        Path(path)
        for pattern in args.input_glob
        for path in glob.glob(pattern)
    })
    rows = []
    for path in paths:
        with path.open(encoding="utf-8", newline="") as handle:
            rows.extend(
                row for row in csv.DictReader(handle)
                if abs(float(row["capacity_scale"]) - args.capacity_scale) < 1e-9
            )
    if not rows:
        raise RuntimeError("No matching capacity rows")

    baseline_usable = None
    if args.baseline_glob:
        baseline_paths = sorted({
            Path(path)
            for pattern in args.baseline_glob
            for path in glob.glob(pattern)
        })
        baseline_usable = set()
        for path in baseline_paths:
            with path.open(encoding="utf-8", newline="") as handle:
                baseline_usable.update(
                    row["sample_id"] for row in csv.DictReader(handle)
                    if row["usable"] == "1"
                )

    outcomes: dict[tuple[str, str], int] = {}
    angles_by_pose: dict[str, dict[str, str]] = {}
    excluded_targets = sorted(set(args.exclude_target))
    all_targets = sorted(
        {row["capacity_target"] for row in rows} - set(excluded_targets)
    )
    for row in rows:
        pose = row["sample_id"].split("@@", 1)[0]
        target = row["capacity_target"]
        angles_by_pose[pose] = row
        if row["usable"] == "1":
            outcomes[(pose, target)] = 0
        elif row["status"] in PHYSICAL_FAILURES:
            outcomes[(pose, target)] = 1
        else:
            outcomes[(pose, target)] = -1
    poses = sorted(angles_by_pose)
    if baseline_usable is not None:
        poses = [pose for pose in poses if pose in baseline_usable]
    detectable_targets = [
        target for target in all_targets
        if any(outcomes.get((pose, target)) == 1 for pose in poses)
    ]
    undetectable_targets = sorted(set(all_targets) - set(detectable_targets))
    hypotheses = ["No modeled capacity loss", *detectable_targets]

    codes: list[list[int]] = []
    for pose in poses:
        codes.append([0] + [outcomes.get((pose, target), -1) for target in detectable_targets])

    constraints = []
    insufficient = []
    witness_histogram = Counter()
    for left in range(len(hypotheses)):
        for right in range(left + 1, len(hypotheses)):
            witnesses = [
                pose_index for pose_index, code in enumerate(codes)
                if code[left] >= 0 and code[right] >= 0 and code[left] != code[right]
            ]
            witness_histogram[len(witnesses)] += 1
            if len(witnesses) < args.pair_distance:
                insufficient.append(
                    {
                        "left": hypotheses[left],
                        "right": hypotheses[right],
                        "available_witnesses": len(witnesses),
                    }
                )
            constraints.append((f"pair_{left}_{right}", witnesses, args.pair_distance))

    args.output_dir.mkdir(parents=True, exist_ok=True)
    base_report = {
        "schema_version": 1,
        "capacity_scale": args.capacity_scale,
        "candidate_posture_count": len(poses),
        "all_target_count": len(all_targets),
        "excluded_equivalent_targets": excluded_targets,
        "detectable_target_count": len(detectable_targets),
        "detectable_targets": detectable_targets,
        "undetectable_targets": undetectable_targets,
        "hypotheses_include_no_loss": True,
        "minimum_pair_distance_requested": args.pair_distance,
        "witness_count_histogram": {str(key): value for key, value in sorted(witness_histogram.items())},
        "insufficient_pairs": insufficient,
        "scope": "Generic-model capacity sensitivity under gravity only; not patient ability, pain, injury, or diagnosis.",
    }
    if insufficient:
        base_report["status"] = "infeasible"
        report_path = args.output_dir / "minimum_capacity_panel.json"
        report_path.write_text(json.dumps(base_report, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"status": "infeasible", "insufficient_pairs": len(insufficient), "report": str(report_path)}))
        return

    def posture_family(pose: str) -> str:
        if pose.startswith("refine__"):
            parts = pose.split("__")
            if len(parts) >= 3:
                return "__".join(parts[1:3])
        return pose

    families: dict[str, list[int]] = {}
    for pose_index, pose in enumerate(poses):
        families.setdefault(posture_family(pose), []).append(pose_index)

    lp_path = args.output_dir / "minimum_capacity_panel.lp"
    solution_path = args.output_dir / "minimum_capacity_panel.solution.txt"
    log_path = args.output_dir / "minimum_capacity_panel.cbc.log"
    with lp_path.open("w", encoding="ascii", newline="\n") as handle:
        handle.write("Minimize\n obj: " + expression(list(range(len(poses)))) + "\nSubject To\n")
        for name, witnesses, distance in constraints:
            handle.write(f" {name}: {expression(witnesses)} >= {distance}\n")
        if args.one_per_family:
            for family_index, members in enumerate(families.values()):
                if len(members) > 1:
                    handle.write(
                        f" family_{family_index}: {expression(members)} <= 1\n"
                    )
        handle.write("Binary\n")
        for start in range(0, len(poses), 20):
            handle.write(" " + " ".join(f"x{index}" for index in range(start, min(start + 20, len(poses)))) + "\n")
        handle.write("End\n")

    project_root = Path(__file__).resolve().parents[1]
    container_lp = "/workspace/" + lp_path.resolve().relative_to(project_root).as_posix()
    container_solution = "/workspace/" + solution_path.resolve().relative_to(project_root).as_posix()
    command = [
        "docker", "exec", args.container, "cbc", container_lp,
        "-seconds", str(args.seconds), "-ratio", "0", "-solve",
        "-solution", container_solution,
    ]
    completed = subprocess.run(command, text=True, capture_output=True, check=False)
    log_path.write_text(completed.stdout + completed.stderr, encoding="utf-8")
    if completed.returncode != 0 or not solution_path.exists():
        raise RuntimeError(f"CBC failed; inspect {log_path}")
    solution = solution_path.read_text(encoding="utf-8")
    if solution.startswith("Infeasible"):
        base_report.update(
            {
                "status": "infeasible_with_family_independence",
                "one_posture_per_movement_family": args.one_per_family,
                "movement_family_count": len(families),
            }
        )
        report_path = args.output_dir / "minimum_capacity_panel.json"
        report_path.write_text(
            json.dumps(base_report, indent=2) + "\n", encoding="utf-8"
        )
        print(json.dumps({
            "status": "infeasible_with_family_independence",
            "report": str(report_path),
        }))
        return
    if not solution.startswith("Optimal"):
        raise RuntimeError(f"CBC did not certify an optimum; inspect {solution_path}")
    selected = []
    for line in solution.splitlines()[1:]:
        fields = line.split()
        for position, field in enumerate(fields[:-1]):
            if field.startswith("x") and field[1:].isdigit():
                if float(fields[position + 1]) > 0.5:
                    selected.append(int(field[1:]))
                break
    selected.sort()

    with (args.output_dir / "minimum_capacity_panel.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["sample_id", *COORDINATES])
        writer.writeheader()
        for index in selected:
            source = angles_by_pose[poses[index]]
            writer.writerow({"sample_id": poses[index], **{name: source[name] for name in COORDINATES}})
    base_report.update(
        {
            "status": "optimal",
            "certified_minimum_posture_count": len(selected),
            "selected_sample_ids": [poses[index] for index in selected],
            "one_posture_per_movement_family": args.one_per_family,
            "selected_movement_family_count": len(
                {posture_family(poses[index]) for index in selected}
            ),
        }
    )
    report_path = args.output_dir / "minimum_capacity_panel.json"
    report_path.write_text(json.dumps(base_report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": "optimal", "count": len(selected), "report": str(report_path)}))


if __name__ == "__main__":
    main()
