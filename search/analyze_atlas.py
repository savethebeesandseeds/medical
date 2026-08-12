#!/usr/bin/env python3
"""Analyze quality-gated batch-search shards and select pilot posture panels."""

from __future__ import annotations

import argparse
import csv
import glob
import json
import math
from collections import Counter
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


def load_rows(pattern: str) -> tuple[list[dict[str, str]], list[str]]:
    paths = sorted(Path(path) for path in glob.glob(pattern))
    if not paths:
        raise FileNotFoundError(f"No atlas shards matched {pattern}")
    rows: list[dict[str, str]] = []
    activation_names: list[str] | None = None
    for path in paths:
        with path.open(encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle)
            names = [
                field.removeprefix("activation__")
                for field in (reader.fieldnames or [])
                if field.startswith("activation__")
            ]
            if activation_names is None:
                activation_names = names
            elif names != activation_names:
                raise ValueError(f"Activation columns differ in {path}")
            rows.extend(reader)
    return rows, activation_names or []


def greedy_panel(
    codes: np.ndarray,
    burden: np.ndarray,
    sample_ids: list[str],
    target_names: list[str],
    minimum_distance: int,
    minimum_high_witnesses: int,
    maximum_size: int,
) -> dict:
    row_count, target_count = codes.shape
    pairs = [(left, right) for left in range(target_count) for right in range(left + 1, target_count)]
    pair_deficit = np.full(len(pairs), minimum_distance, dtype=int)
    on_deficit = np.full(target_count, minimum_high_witnesses, dtype=int)
    witnesses: list[np.ndarray] = []
    for left, right in pairs:
        witnesses.append((codes[:, left] >= 0) & (codes[:, right] >= 0) & (codes[:, left] != codes[:, right]))

    selected: list[int] = []
    available = np.ones(row_count, dtype=bool)
    while len(selected) < maximum_size:
        scores = np.zeros(row_count, dtype=float)
        for pair_index, witness in enumerate(witnesses):
            if pair_deficit[pair_index] > 0:
                scores += witness.astype(float)
        for target in range(target_count):
            if on_deficit[target] > 0:
                scores += (codes[:, target] == 1).astype(float)
        scores[~available] = -1.0
        scores -= burden * 0.01
        best = int(np.argmax(scores))
        if scores[best] <= 0:
            break
        selected.append(best)
        available[best] = False
        for pair_index, witness in enumerate(witnesses):
            if pair_deficit[pair_index] > 0 and witness[best]:
                pair_deficit[pair_index] -= 1
        for target in range(target_count):
            if on_deficit[target] > 0 and codes[best, target] == 1:
                on_deficit[target] -= 1
        if np.all(pair_deficit <= 0) and np.all(on_deficit <= 0):
            break

    unresolved_pairs = []
    for pair_index, (left, right) in enumerate(pairs):
        if pair_deficit[pair_index] > 0:
            unresolved_pairs.append(
                {
                    "left": target_names[left],
                    "right": target_names[right],
                    "additional_witnesses_needed": int(pair_deficit[pair_index]),
                }
            )
    unresolved_targets = [
        {
            "target": target_names[index],
            "additional_high_witnesses_needed": int(on_deficit[index]),
        }
        for index in range(target_count)
        if on_deficit[index] > 0
    ]
    return {
        "minimum_pair_distance_requested": minimum_distance,
        "minimum_high_witnesses_requested": minimum_high_witnesses,
        "selected_count": len(selected),
        "complete": bool(np.all(pair_deficit <= 0) and np.all(on_deficit <= 0)),
        "unresolved_pair_constraints": int(np.sum(pair_deficit > 0)),
        "unresolved_high_targets": int(np.sum(on_deficit > 0)),
        "unresolved_pairs": unresolved_pairs,
        "unresolved_targets": unresolved_targets,
        "selected_sample_ids": [sample_ids[index] for index in selected],
        "selected_indices": selected,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--input-glob", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()

    config = json.loads(args.config.read_text(encoding="utf-8"))
    settings = config["analysis"]
    rows, muscles = load_rows(args.input_glob)
    statuses = Counter(row["status"] for row in rows)
    usable_rows = [row for row in rows if row["usable"] == "1"]
    args.output_dir.mkdir(parents=True, exist_ok=True)

    report: dict = {
        "schema_version": 1,
        "study_name": config["study_name"],
        "interpretation": config["interpretation"],
        "total_poses": len(rows),
        "usable_poses": len(usable_rows),
        "usable_fraction": len(usable_rows) / len(rows) if rows else 0.0,
        "status_counts": dict(sorted(statuses.items())),
        "muscle_count": len(muscles),
    }
    if not usable_rows:
        (args.output_dir / "identifiability_report.json").write_text(
            json.dumps(report, indent=2) + "\n", encoding="utf-8"
        )
        raise RuntimeError("No usable exact postures were available for analysis")

    durations = np.asarray([float(row["duration_ms"]) for row in rows], dtype=float)
    activations = np.asarray(
        [[float(row[f"activation__{muscle}"]) for muscle in muscles] for row in usable_rows],
        dtype=float,
    )
    coordinates = np.asarray(
        [[float(row[name]) for name in COORDINATES] for row in usable_rows], dtype=float
    )
    sample_ids = [row["sample_id"] for row in usable_rows]
    floor = float(settings["authored_control_floor"])
    signal = np.maximum(0.0, activations - floor)
    scale = np.quantile(signal, 0.99, axis=0)
    normalized = np.divide(signal, scale, out=np.zeros_like(signal), where=scale > 1e-9)
    normalized = np.clip(normalized, 0.0, 1.0)

    centered = activations - np.mean(activations, axis=0, keepdims=True)
    singular_values = np.linalg.svd(centered, full_matrices=False, compute_uv=False)
    variance = singular_values * singular_values
    explained = variance / np.sum(variance) if np.sum(variance) > 0 else variance
    cumulative = np.cumsum(explained)

    group_names = list(config["primary_target_groups"].keys())
    group_columns: list[np.ndarray] = []
    group_absolute: list[np.ndarray] = []
    for group_name in group_names:
        members = config["primary_target_groups"][group_name]
        indices = [muscles.index(member) for member in members]
        group_columns.append(np.mean(normalized[:, indices], axis=1))
        group_absolute.append(np.mean(signal[:, indices], axis=1))
    group_matrix = np.column_stack(group_columns)
    group_signal = np.column_stack(group_absolute)

    high = float(settings["normalized_high_threshold"])
    low = float(settings["normalized_low_threshold"])
    absolute_margin = float(settings["absolute_signal_margin"])
    codes = np.full(group_matrix.shape, -1, dtype=np.int8)
    codes[group_matrix <= low] = 0
    codes[(group_matrix >= high) & (group_signal >= absolute_margin)] = 1

    bounds = config["candidate_domain"]["coordinates_degrees"]
    burden = np.zeros(coordinates.shape[0], dtype=float)
    for coordinate_index, coordinate_name in enumerate(COORDINATES):
        low_bound, high_bound = (float(value) for value in bounds[coordinate_name])
        center = (low_bound + high_bound) / 2.0
        half_range = max((high_bound - low_bound) / 2.0, 1e-9)
        burden += np.abs((coordinates[:, coordinate_index] - center) / half_range)
    burden /= len(COORDINATES)

    noiseless_panel = greedy_panel(
        codes,
        burden,
        sample_ids,
        group_names,
        minimum_distance=1,
        minimum_high_witnesses=1,
        maximum_size=int(settings["maximum_panel_size"]),
    )
    robust_panel = greedy_panel(
        codes,
        burden,
        sample_ids,
        group_names,
        minimum_distance=int(settings["robust_pair_distance"]),
        minimum_high_witnesses=int(settings["minimum_high_witnesses_per_target"]),
        maximum_size=int(settings["maximum_panel_size"]),
    )

    pair_separability = []
    for left in range(len(group_names)):
        for right in range(left + 1, len(group_names)):
            differences = np.abs(group_matrix[:, left] - group_matrix[:, right])
            best_index = int(np.argmax(differences))
            pair_separability.append(
                {
                    "left": group_names[left],
                    "right": group_names[right],
                    "maximum_normalized_difference": float(differences[best_index]),
                    "best_sample_id": sample_ids[best_index],
                }
            )

    target_summary = []
    for index, group_name in enumerate(group_names):
        best = int(np.argmax(group_matrix[:, index]))
        target_summary.append(
            {
                "target": group_name,
                "maximum_normalized_demand": float(group_matrix[best, index]),
                "maximum_mean_activation": float(group_signal[best, index] + floor),
                "best_sample_id": sample_ids[best],
                "high_witness_count": int(np.sum(codes[:, index] == 1)),
                "ambiguous_count": int(np.sum(codes[:, index] < 0)),
            }
        )

    report.update(
        {
            "duration_ms": {
                "median": float(np.median(durations)),
                "p95": float(np.quantile(durations, 0.95)),
                "maximum": float(np.max(durations)),
            },
            "activation_space": {
                "components_for_90_percent_variance": int(np.searchsorted(cumulative, 0.90) + 1),
                "components_for_95_percent_variance": int(np.searchsorted(cumulative, 0.95) + 1),
                "components_for_99_percent_variance": int(np.searchsorted(cumulative, 0.99) + 1),
            },
            "thresholds": {
                "control_floor": floor,
                "absolute_signal_margin": absolute_margin,
                "normalized_high": high,
                "normalized_low": low,
            },
            "targets": target_summary,
            "weakest_pair_separations": sorted(
                pair_separability, key=lambda item: item["maximum_normalized_difference"]
            )[:20],
            "noiseless_greedy_panel": noiseless_panel,
            "one_error_greedy_panel": robust_panel,
            "warning": "Pilot greedy panels are upper bounds for this finite candidate sample, not clinical diagnostic batteries and not proven global minima.",
        }
    )

    selected_ids = set(noiseless_panel["selected_sample_ids"]) | set(robust_panel["selected_sample_ids"])
    with (args.output_dir / "selected_postures.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["sample_id", *COORDINATES])
        writer.writeheader()
        for row in usable_rows:
            if row["sample_id"] in selected_ids:
                writer.writerow({name: row[name] for name in writer.fieldnames})

    report_path = args.output_dir / "identifiability_report.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    markdown = [
        "# MoBL-ARMS posture identifiability pilot",
        "",
        "> Generic-model muscle-demand study. Not patient data and not a diagnosis.",
        "",
        f"- Exact postures: {len(rows)}",
        f"- Passed all solver quality gates: {len(usable_rows)} ({report['usable_fraction']:.1%})",
        f"- Median solve time: {report['duration_ms']['median']:.0f} ms",
        f"- 95th-percentile solve time: {report['duration_ms']['p95']:.0f} ms",
        f"- Activation components explaining 95% variance: {report['activation_space']['components_for_95_percent_variance']}",
        "",
        "## Pilot panel results",
        "",
        f"- Noiseless greedy upper bound: {noiseless_panel['selected_count']} postures; complete={noiseless_panel['complete']}",
        f"- One-error-distance greedy upper bound: {robust_panel['selected_count']} postures; complete={robust_panel['complete']}",
        f"- Unresolved robust pair constraints: {robust_panel['unresolved_pair_constraints']}",
        "",
        "These panels use model-demand signatures only. Functional `able / unable` inference requires separate muscle-capacity reduction and equilibrium re-solves.",
        "",
        "## Targets with the fewest high-demand witnesses",
        "",
    ]
    for item in sorted(target_summary, key=lambda target: target["high_witness_count"])[:10]:
        markdown.append(
            f"- {item['target']}: {item['high_witness_count']} high-demand witnesses; best sample `{item['best_sample_id']}`"
        )
    markdown.extend(["", "See `identifiability_report.json` for full machine-readable results.", ""])
    (args.output_dir / "identifiability_report.md").write_text(
        "\n".join(markdown), encoding="utf-8"
    )
    print(json.dumps({"status": "ok", "report": str(report_path), "usable": len(usable_rows)}))


if __name__ == "__main__":
    main()
