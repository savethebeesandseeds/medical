#!/usr/bin/env python3
"""Generate local angle-robustness candidates for undercovered capacity pairs."""

from __future__ import annotations

import argparse
import csv
import glob
import json
import re
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


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--input-glob", required=True)
    parser.add_argument("--infeasible-report", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--capacity-scale", type=float, default=0.0)
    parser.add_argument("--deltas", default="2,5")
    args = parser.parse_args()

    config = json.loads(args.config.read_text(encoding="utf-8"))
    bounds = config["candidate_domain"]["coordinates_degrees"]
    report = json.loads(args.infeasible_report.read_text(encoding="utf-8"))
    pairs = [(item["left"], item["right"]) for item in report["insufficient_pairs"]]
    deltas = [float(value) for value in args.deltas.split(",")]

    rows = []
    for path in sorted(Path(path) for path in glob.glob(args.input_glob)):
        with path.open(encoding="utf-8", newline="") as handle:
            rows.extend(
                row for row in csv.DictReader(handle)
                if abs(float(row["capacity_scale"]) - args.capacity_scale) < 1e-9
            )
    outcomes: dict[tuple[str, str], int] = {}
    pose_rows: dict[str, dict[str, str]] = {}
    for row in rows:
        pose = row["sample_id"].split("@@", 1)[0]
        pose_rows[pose] = row
        if row["usable"] == "1":
            outcome = 0
        elif row["status"] in PHYSICAL_FAILURES:
            outcome = 1
        else:
            outcome = -1
        outcomes[(pose, row["capacity_target"])] = outcome

    witness_sources: set[str] = set()
    pair_sources = {}
    for left, right in pairs:
        witnesses = []
        for pose in sorted(pose_rows):
            left_code = 0 if left == "No modeled capacity loss" else outcomes.get((pose, left), -1)
            right_code = 0 if right == "No modeled capacity loss" else outcomes.get((pose, right), -1)
            if left_code >= 0 and right_code >= 0 and left_code != right_code:
                witnesses.append(pose)
                witness_sources.add(pose)
        pair_sources[f"{left} <> {right}"] = witnesses

    generated: dict[tuple[float, ...], tuple[str, list[float]]] = {}
    for pose in sorted(witness_sources):
        source = pose_rows[pose]
        base = [float(source[name]) for name in COORDINATES]
        for coordinate_index, coordinate in enumerate(COORDINATES):
            minimum, maximum = (float(value) for value in bounds[coordinate])
            for delta in deltas:
                for direction in (-1.0, 1.0):
                    angles = list(base)
                    candidate = angles[coordinate_index] + direction * delta
                    if candidate < minimum or candidate > maximum:
                        continue
                    angles[coordinate_index] = candidate
                    key = tuple(round(value, 8) for value in angles)
                    identifier = (
                        f"refine__{pose}__{coordinate}__"
                        f"{'p' if direction > 0 else 'm'}{delta:g}"
                    )
                    generated[key] = (identifier, angles)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["sample_id", *COORDINATES])
        for identifier, angles in sorted(generated.values()):
            writer.writerow([identifier, *(f"{value:.8f}" for value in angles)])
    refinement_report = {
        "schema_version": 1,
        "capacity_scale": args.capacity_scale,
        "deltas_degrees": deltas,
        "undercovered_pair_count": len(pairs),
        "witness_source_count": len(witness_sources),
        "generated_posture_count": len(generated),
        "pair_witness_sources": pair_sources,
    }
    args.output.with_suffix(".json").write_text(
        json.dumps(refinement_report, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps({"status": "ok", "postures": len(generated), "output": str(args.output)}))


if __name__ == "__main__":
    main()
