#!/usr/bin/env python3
"""Expand selected postures into muscle-capacity sensitivity cases."""

from __future__ import annotations

import argparse
import csv
import json
import random
import re
from pathlib import Path


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
    parser.add_argument("--postures", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--scales", default="0.75,0.5,0.25,0")
    parser.add_argument("--seed", type=int, default=20260812)
    args = parser.parse_args()

    config = json.loads(args.config.read_text(encoding="utf-8"))
    scales = [float(value) for value in args.scales.split(",")]
    if not scales or any(value < 0.0 or value > 1.0 for value in scales):
        raise ValueError("All capacity scales must be between zero and one")
    with args.postures.open(encoding="utf-8", newline="") as handle:
        postures = list(csv.DictReader(handle))
    if not postures:
        raise ValueError("No postures were supplied")

    cases: list[list[str]] = []
    for posture in postures:
        for target, muscles in config["primary_target_groups"].items():
            for scale in scales:
                sample_id = (
                    f"{posture['sample_id']}@@{slug(target)}@@{scale:.2f}"
                )
                cases.append(
                    [
                        sample_id,
                        *(posture[name] for name in COORDINATES),
                        target,
                        ";".join(muscles),
                        f"{scale:.6f}",
                    ]
                )

    if args.workers < 1 or args.workers > len(cases):
        raise ValueError("--workers must be between one and the case count")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    paths = [args.output_dir / f"capacity_{index:02d}.csv" for index in range(args.workers)]
    handles = [path.open("w", encoding="utf-8", newline="") for path in paths]
    try:
        writers = [csv.writer(handle) for handle in handles]
        header = [
            "sample_id",
            *COORDINATES,
            "capacity_target",
            "capacity_muscles",
            "capacity_scale",
        ]
        for writer in writers:
            writer.writerow(header)
        assignment = list(range(len(cases)))
        random.Random(args.seed ^ 0xC4A6A17).shuffle(assignment)
        for position, case_index in enumerate(assignment):
            writers[position % args.workers].writerow(cases[case_index])
    finally:
        for handle in handles:
            handle.close()

    manifest = {
        "schema_version": 1,
        "source_posture_count": len(postures),
        "target_count": len(config["primary_target_groups"]),
        "scales": scales,
        "case_count": len(cases),
        "workers": args.workers,
        "shards": [path.name for path in paths],
    }
    (args.output_dir / "capacity_manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(manifest))


if __name__ == "__main__":
    main()
