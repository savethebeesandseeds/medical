#!/usr/bin/env python3
"""Generate a structured moderate-angle capacity-screen candidate library.

These are generic-model research postures, not exercises or clinical tests.
The library favors recognizable, progressive movements and neutral wrist angles
over activation-space extremes.
"""

from __future__ import annotations

import argparse
import csv
import json
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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    postures: list[dict[str, object]] = []

    def add(sample_id: str, label: str, family: str, angles: list[float]) -> None:
        if len(angles) != len(COORDINATES):
            raise ValueError(f"{sample_id}: expected seven angles")
        postures.append({
            "sample_id": sample_id,
            "label": label,
            "movement_family": family,
            **dict(zip(COORDINATES, angles, strict=True)),
        })

    add("moderate__neutral", "Arm relaxed at side", "baseline", [0, 0, 0, 0, 0, 0, 0])
    add("moderate__elbow_45", "Elbow bend 45 degrees", "elbow", [0, 0, 0, 45, 0, 0, 0])
    add("moderate__elbow_90", "Elbow bend 90 degrees", "elbow", [0, 0, 0, 90, 0, 0, 0])

    planes = ((0, "side", "Lateral raise"), (45, "scaption", "Diagonal raise"), (90, "forward", "Forward raise"))
    for plane, slug, label in planes:
        for elevation in (15, 30, 45, 60, 75):
            add(
                f"moderate__{slug}_{elevation}",
                f"{label} {elevation} degrees",
                f"raise_{slug}",
                [plane, elevation, 0, 0, 0, 0, 0],
            )
        for elevation in (30, 45, 60):
            add(
                f"moderate__{slug}_{elevation}_elbow_90",
                f"{label} {elevation} degrees, elbow bent",
                f"raise_{slug}_bent_elbow",
                [plane, elevation, 0, 90, 0, 0, 0],
            )

    for rotation in (-40, -20, 20, 40):
        direction = "internal" if rotation < 0 else "external"
        add(
            f"moderate__rotation_side_{direction}_{abs(rotation)}",
            f"{direction.title()} rotation {abs(rotation)} degrees at side",
            "rotation_at_side",
            [0, 15, rotation, 90, 0, 0, 0],
        )
    for elevation in (30, 45, 60):
        for rotation in (-30, 30):
            direction = "internal" if rotation < 0 else "external"
            add(
                f"moderate__scaption_{elevation}_{direction}_30",
                f"Diagonal raise {elevation} degrees, {direction} rotation",
                f"rotation_in_scaption_{elevation}",
                [45, elevation, rotation, 90, 0, 0, 0],
            )

    for forearm in (-45, 45):
        direction = "pronation" if forearm < 0 else "supination"
        add(
            f"moderate__forearm_{direction}_45",
            f"Forearm {direction} 45 degrees, elbow bent",
            "forearm_rotation",
            [0, 0, 0, 90, forearm, 0, 0],
        )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    # The C++ batch solver deliberately accepts only its narrow input schema.
    # Human labels and movement families remain in the companion JSON.
    fieldnames = ["sample_id", *COORDINATES]
    with args.output.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for posture in postures:
            writer.writerow({name: posture[name] for name in fieldnames})
    args.output.with_suffix(".json").write_text(
        json.dumps({
            "schema_version": 1,
            "scope": "Structured moderate-angle generic-model postures; not exercises, patient data, or validated clinical tests.",
            "posture_count": len(postures),
            "angle_policy_degrees": {
                "maximum_shoulder_elevation": 75,
                "maximum_absolute_shoulder_rotation": 40,
                "maximum_elbow_flexion": 90,
                "maximum_absolute_forearm_rotation": 45,
                "wrist": "neutral",
            },
            "postures": postures,
        }, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"status": "ok", "postures": len(postures), "output": str(args.output)}))


if __name__ == "__main__":
    main()
