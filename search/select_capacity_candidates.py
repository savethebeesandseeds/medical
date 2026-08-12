#!/usr/bin/env python3
"""Select a compact shared capacity-search library from an exact atlas."""

from __future__ import annotations

import argparse
import csv
import glob
import json
from pathlib import Path

import numpy as np


COORDINATES = (
    "elv_angle",
    "shoulder_elv",
    "shoulder_rot",
    "elbow_flexion",
    "pro_sup",
    "deviation",
    "flexion",
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--input-glob", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--demand-per-target", type=int, default=4)
    parser.add_argument("--selectivity-per-target", type=int, default=4)
    args = parser.parse_args()

    paths = sorted(Path(path) for path in glob.glob(args.input_glob))
    rows: list[dict[str, str]] = []
    muscles: list[str] | None = None
    for path in paths:
        with path.open(encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle)
            current = [
                field.removeprefix("activation__")
                for field in (reader.fieldnames or [])
                if field.startswith("activation__")
            ]
            muscles = current if muscles is None else muscles
            rows.extend(row for row in reader if row["usable"] == "1")
    muscles = muscles or []
    if not rows:
        raise RuntimeError("No usable atlas postures")

    config = json.loads(args.config.read_text(encoding="utf-8"))
    settings = config["analysis"]
    activations = np.asarray(
        [[float(row[f"activation__{muscle}"]) for muscle in muscles] for row in rows],
        dtype=float,
    )
    signal = np.maximum(0.0, activations - float(settings["authored_control_floor"]))
    scale = np.quantile(signal, 0.99, axis=0)
    normalized = np.divide(signal, scale, out=np.zeros_like(signal), where=scale > 1e-9)
    normalized = np.clip(normalized, 0.0, 1.0)

    targets = list(config["primary_target_groups"].keys())
    groups = []
    for target in targets:
        indices = [muscles.index(name) for name in config["primary_target_groups"][target]]
        groups.append(np.mean(normalized[:, indices], axis=1))
    matrix = np.column_stack(groups)

    selected: set[int] = set()
    provenance: dict[str, dict[str, list[str]]] = {}
    for target_index, target in enumerate(targets):
        demand = matrix[:, target_index]
        competitors = np.max(np.delete(matrix, target_index, axis=1), axis=1)
        selectivity = demand - competitors
        demand_indices = np.argsort(demand)[-args.demand_per_target :][::-1].tolist()
        selectivity_indices = np.argsort(selectivity)[-args.selectivity_per_target :][::-1].tolist()
        selected.update(demand_indices)
        selected.update(selectivity_indices)
        provenance[target] = {
            "highest_demand": [rows[index]["sample_id"] for index in demand_indices],
            "highest_selectivity": [rows[index]["sample_id"] for index in selectivity_indices],
        }

    ordered = sorted(selected, key=lambda index: rows[index]["sample_id"])
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["sample_id", *COORDINATES])
        writer.writeheader()
        for index in ordered:
            writer.writerow({name: rows[index][name] for name in writer.fieldnames})
    report = {
        "schema_version": 1,
        "source_usable_pose_count": len(rows),
        "target_count": len(targets),
        "demand_candidates_per_target": args.demand_per_target,
        "selectivity_candidates_per_target": args.selectivity_per_target,
        "unique_selected_posture_count": len(ordered),
        "provenance": provenance,
    }
    report_path = args.output.with_suffix(".json")
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": "ok", "postures": len(ordered), "output": str(args.output)}))


if __name__ == "__main__":
    main()
