#!/usr/bin/env python3
"""Generate deterministic low-discrepancy MoBL-ARMS posture candidates.

This script intentionally has no third-party dependencies. It implements the
first seven dimensions of a Sobol sequence, applies a seeded digital shift,
adds declared anchor postures, and writes independent worker shards.
"""

from __future__ import annotations

import argparse
import csv
import json
import random
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

# Bratley-Fox direction-number seeds for dimensions 2 through 7.
SOBOL_PARAMETERS = (
    (1, 0, (1,)),
    (2, 1, (1, 3)),
    (3, 1, (1, 3, 1)),
    (3, 2, (1, 1, 1)),
    (4, 1, (1, 1, 3, 3)),
    (4, 4, (1, 3, 5, 13)),
)


def direction_numbers(bits: int = 32) -> list[list[int]]:
    directions: list[list[int]] = []
    directions.append([0] + [1 << (bits - index) for index in range(1, bits + 1)])
    for degree, coefficient, seeds in SOBOL_PARAMETERS:
        values = [0] * (bits + 1)
        for index in range(1, degree + 1):
            values[index] = seeds[index - 1] << (bits - index)
        for index in range(degree + 1, bits + 1):
            value = values[index - degree] ^ (values[index - degree] >> degree)
            for offset in range(1, degree):
                if (coefficient >> (degree - 1 - offset)) & 1:
                    value ^= values[index - offset]
            values[index] = value
        directions.append(values)
    return directions


def sobol_points(count: int, dimensions: int, seed: int) -> list[list[float]]:
    if dimensions < 1 or dimensions > 7:
        raise ValueError("This generator supports between one and seven dimensions")
    directions = direction_numbers()
    rng = random.Random(seed)
    shifts = [rng.getrandbits(32) for _ in range(dimensions)]
    scale = float(1 << 32)
    points: list[list[float]] = []
    for sequence_index in range(1, count + 1):
        gray = sequence_index ^ (sequence_index >> 1)
        point: list[float] = []
        for dimension in range(dimensions):
            value = shifts[dimension]
            bit = 1
            gray_copy = gray
            while gray_copy:
                if gray_copy & 1:
                    value ^= directions[dimension][bit]
                gray_copy >>= 1
                bit += 1
            point.append(value / scale)
        points.append(point)
    return points


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--count", type=int, default=512)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--seed", type=int, default=20260812)
    args = parser.parse_args()

    if args.count < 1:
        raise ValueError("--count must be positive")
    if args.workers < 1 or args.workers > args.count:
        raise ValueError("--workers must be between 1 and --count")

    config = json.loads(args.config.read_text(encoding="utf-8"))
    bounds = config["candidate_domain"]["coordinates_degrees"]
    for coordinate in COORDINATES:
        if coordinate not in bounds or len(bounds[coordinate]) != 2:
            raise ValueError(f"Missing bounds for {coordinate}")

    rows: list[tuple[str, list[float]]] = []
    seen: set[tuple[float, ...]] = set()
    for anchor in config.get("anchors", []):
        angles = [float(value) for value in anchor["angles"]]
        if len(angles) != len(COORDINATES):
            raise ValueError(f"Anchor {anchor['name']} does not have seven angles")
        key = tuple(round(value, 8) for value in angles)
        if key not in seen:
            rows.append((f"anchor__{anchor['name']}", angles))
            seen.add(key)

    needed = max(0, args.count - len(rows))
    for index, unit_point in enumerate(sobol_points(needed, len(COORDINATES), args.seed)):
        angles = []
        for coordinate, unit_value in zip(COORDINATES, unit_point):
            low, high = (float(value) for value in bounds[coordinate])
            angles.append(low + unit_value * (high - low))
        rows.append((f"sobol__{index + 1:07d}", angles))

    args.output_dir.mkdir(parents=True, exist_ok=True)
    shard_paths = [args.output_dir / f"candidates_{index:02d}.csv" for index in range(args.workers)]
    handles = [path.open("w", encoding="utf-8", newline="") for path in shard_paths]
    try:
        writers = [csv.writer(handle) for handle in handles]
        header = ["sample_id", *COORDINATES]
        for writer in writers:
            writer.writerow(header)
        assignment_order = list(range(len(rows)))
        random.Random(args.seed ^ 0x5A17C9E3).shuffle(assignment_order)
        for position, row_index in enumerate(assignment_order):
            sample_id, angles = rows[row_index]
            writers[position % args.workers].writerow(
                [sample_id, *(f"{value:.8f}" for value in angles)]
            )
    finally:
        for handle in handles:
            handle.close()

    manifest = {
        "schema_version": 1,
        "generator": "seven-dimensional Sobol sequence with seeded digital shift",
        "seed": args.seed,
        "requested_count": args.count,
        "generated_count": len(rows),
        "workers": args.workers,
        "sharding": "seeded balanced permutation",
        "coordinates": list(COORDINATES),
        "shards": [path.name for path in shard_paths],
    }
    (args.output_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(manifest))


if __name__ == "__main__":
    main()
