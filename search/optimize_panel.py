#!/usr/bin/env python3
"""Certify minimum posture panels for a finite exact OpenSim atlas using CBC."""

from __future__ import annotations

import argparse
import csv
import glob
import json
import subprocess
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


def expression(variable_indices: list[int]) -> str:
    if not variable_indices:
        return "0"
    chunks = []
    for start in range(0, len(variable_indices), 80):
        chunks.append(" + ".join(f"x{index}" for index in variable_indices[start : start + 80]))
    return "\n  + ".join(chunks)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--input-glob", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--pair-distance", type=int, required=True)
    parser.add_argument("--high-witnesses", type=int, required=True)
    parser.add_argument("--seconds", type=int, default=300)
    parser.add_argument("--container", default="opensim-muscles")
    args = parser.parse_args()

    paths = sorted(Path(path) for path in glob.glob(args.input_glob))
    if not paths:
        raise FileNotFoundError(f"No atlas shards matched {args.input_glob}")
    rows: list[dict[str, str]] = []
    muscles: list[str] | None = None
    for path in paths:
        with path.open(encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle)
            current_muscles = [
                field.removeprefix("activation__")
                for field in (reader.fieldnames or [])
                if field.startswith("activation__")
            ]
            if muscles is None:
                muscles = current_muscles
            elif muscles != current_muscles:
                raise ValueError(f"Activation columns differ in {path}")
            rows.extend(row for row in reader if row["usable"] == "1")
    muscles = muscles or []
    if not rows:
        raise RuntimeError("No usable atlas rows")

    config = json.loads(args.config.read_text(encoding="utf-8"))
    settings = config["analysis"]
    activations = np.asarray(
        [[float(row[f"activation__{muscle}"]) for muscle in muscles] for row in rows],
        dtype=float,
    )
    floor = float(settings["authored_control_floor"])
    signal = np.maximum(0.0, activations - floor)
    scale = np.quantile(signal, 0.99, axis=0)
    normalized = np.divide(signal, scale, out=np.zeros_like(signal), where=scale > 1e-9)
    normalized = np.clip(normalized, 0.0, 1.0)

    target_names = list(config["primary_target_groups"].keys())
    group_normalized = []
    group_signal = []
    for target in target_names:
        indices = [muscles.index(name) for name in config["primary_target_groups"][target]]
        group_normalized.append(np.mean(normalized[:, indices], axis=1))
        group_signal.append(np.mean(signal[:, indices], axis=1))
    group_normalized_matrix = np.column_stack(group_normalized)
    group_signal_matrix = np.column_stack(group_signal)
    codes = np.full(group_normalized_matrix.shape, -1, dtype=np.int8)
    codes[group_normalized_matrix <= float(settings["normalized_low_threshold"])] = 0
    codes[
        (group_normalized_matrix >= float(settings["normalized_high_threshold"]))
        & (group_signal_matrix >= float(settings["absolute_signal_margin"]))
    ] = 1

    constraints: list[tuple[str, list[int], int]] = []
    for left in range(len(target_names)):
        for right in range(left + 1, len(target_names)):
            variables = np.flatnonzero(
                (codes[:, left] >= 0)
                & (codes[:, right] >= 0)
                & (codes[:, left] != codes[:, right])
            ).tolist()
            if len(variables) < args.pair_distance:
                raise RuntimeError(
                    f"Insufficient witnesses for {target_names[left]} versus {target_names[right]}: {len(variables)}"
                )
            constraints.append((f"pair_{left}_{right}", variables, args.pair_distance))
    for target in range(len(target_names)):
        variables = np.flatnonzero(codes[:, target] == 1).tolist()
        if len(variables) < args.high_witnesses:
            raise RuntimeError(
                f"Insufficient high-demand witnesses for {target_names[target]}: {len(variables)}"
            )
        constraints.append((f"high_{target}", variables, args.high_witnesses))

    args.output_dir.mkdir(parents=True, exist_ok=True)
    lp_path = args.output_dir / "minimum_panel.lp"
    solution_path = args.output_dir / "minimum_panel.solution.txt"
    log_path = args.output_dir / "minimum_panel.cbc.log"
    with lp_path.open("w", encoding="ascii", newline="\n") as handle:
        handle.write("Minimize\n obj: ")
        handle.write(expression(list(range(len(rows)))))
        handle.write("\nSubject To\n")
        for name, variables, lower_bound in constraints:
            handle.write(f" {name}: {expression(variables)} >= {lower_bound}\n")
        handle.write("Binary\n")
        for start in range(0, len(rows), 20):
            handle.write(" " + " ".join(f"x{index}" for index in range(start, min(start + 20, len(rows)))) + "\n")
        handle.write("End\n")

    project_root = Path(__file__).resolve().parents[1]
    container_lp = "/workspace/" + lp_path.resolve().relative_to(project_root).as_posix()
    container_solution = "/workspace/" + solution_path.resolve().relative_to(project_root).as_posix()
    command = [
        "docker",
        "exec",
        args.container,
        "cbc",
        container_lp,
        "-seconds",
        str(args.seconds),
        "-ratio",
        "0",
        "-solve",
        "-solution",
        container_solution,
    ]
    completed = subprocess.run(command, text=True, capture_output=True, check=False)
    log_path.write_text(completed.stdout + completed.stderr, encoding="utf-8")
    if completed.returncode != 0 or not solution_path.exists():
        raise RuntimeError(f"CBC failed; inspect {log_path}")

    solution_text = solution_path.read_text(encoding="utf-8")
    if not solution_text.startswith("Optimal"):
        raise RuntimeError(f"CBC did not certify an optimum; inspect {solution_path}")
    selected_indices = []
    for line in solution_text.splitlines()[1:]:
        fields = line.split()
        for position, field in enumerate(fields[:-1]):
            if field.startswith("x") and field[1:].isdigit():
                if float(fields[position + 1]) > 0.5:
                    selected_indices.append(int(field[1:]))
                break
    selected_indices.sort()

    selected_csv = args.output_dir / "minimum_panel.csv"
    with selected_csv.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["sample_id", *COORDINATES])
        writer.writeheader()
        for index in selected_indices:
            writer.writerow({name: rows[index][name] for name in writer.fieldnames})

    report = {
        "schema_version": 1,
        "status": "optimal",
        "candidate_library_size": len(rows),
        "target_count": len(target_names),
        "target_names": target_names,
        "minimum_pair_distance": args.pair_distance,
        "minimum_high_witnesses": args.high_witnesses,
        "certified_minimum_posture_count": len(selected_indices),
        "selected_sample_ids": [rows[index]["sample_id"] for index in selected_indices],
        "scope": "Finite exact atlas and declared demand thresholds only; not a clinical diagnostic minimum.",
    }
    report_path = args.output_dir / "minimum_panel.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": "optimal", "count": len(selected_indices), "report": str(report_path)}))


if __name__ == "__main__":
    main()
