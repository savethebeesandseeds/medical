#!/usr/bin/env python3
"""Export a browser-friendly default-pose preview of MS-Human-700.

This is deliberately an offline build step. The application continues to use
OpenSim for its existing upper-limb analysis; MuJoCo is only needed when this
preview is regenerated from the vendored MJCF source.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import struct
from pathlib import Path

import mujoco
import numpy as np


MAGIC = b"MSH700B1"
SOURCE_COMMIT = "da76818e269b82289eba39808e2fb91d679d6994"
REGIONS = (
    (0, 50, "Right leg"),
    (50, 100, "Left leg"),
    (100, 161, "Right arm"),
    (161, 222, "Left arm"),
    (222, 700, "Torso"),
)


def view_coordinates(values: np.ndarray) -> np.ndarray:
    """Rotate MuJoCo's Z-up coordinates into the preview's Y-up frame."""
    return np.stack((values[..., 0], values[..., 2], -values[..., 1]), axis=-1)


def region_for(actuator_index: int) -> str:
    for start, end, label in REGIONS:
        if start <= actuator_index < end:
            return label
    raise ValueError(f"Unexpected actuator index: {actuator_index}")


def name_for(model: mujoco.MjModel, object_type: mujoco.mjtObj, index: int) -> str:
    name = mujoco.mj_id2name(model, object_type, index)
    return name or f"unnamed_{index}"


def source_tree_digest(source_root: Path) -> tuple[str, int]:
    """Hash all upstream model inputs with stable relative paths and ordering."""
    files = sorted(
        (
            path for path in source_root.rglob("*")
            if path.is_file() and path.name != "SOURCE.md"
        ),
        key=lambda path: path.relative_to(source_root).as_posix(),
    )
    digest = hashlib.sha256()
    for path in files:
        digest.update(path.relative_to(source_root).as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest(), len(files)


def export_geometry(model: mujoco.MjModel, data: mujoco.MjData) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    positions: list[np.ndarray] = []
    colors: list[np.ndarray] = []
    indices: list[np.ndarray] = []
    vertex_offset = 0

    mesh_geom_ids = np.flatnonzero(model.geom_type == mujoco.mjtGeom.mjGEOM_MESH)
    for geom_id_value in mesh_geom_ids:
        geom_id = int(geom_id_value)
        mesh_id = int(model.geom_dataid[geom_id])
        vertex_start = int(model.mesh_vertadr[mesh_id])
        vertex_count = int(model.mesh_vertnum[mesh_id])
        face_start = int(model.mesh_faceadr[mesh_id])
        face_count = int(model.mesh_facenum[mesh_id])

        local_vertices = np.asarray(
            model.mesh_vert[vertex_start : vertex_start + vertex_count],
            dtype=np.float64,
        )
        rotation = np.asarray(data.geom_xmat[geom_id], dtype=np.float64).reshape(3, 3)
        translation = np.asarray(data.geom_xpos[geom_id], dtype=np.float64)
        world_vertices = local_vertices @ rotation.T + translation
        positions.append(view_coordinates(world_vertices).astype("<f4"))

        rgb = np.asarray(model.geom_rgba[geom_id, :3], dtype=np.float32)
        colors.append(np.broadcast_to(rgb, (vertex_count, 3)).copy().astype("<f4"))

        faces = np.asarray(
            model.mesh_face[face_start : face_start + face_count],
            dtype=np.uint32,
        )
        indices.append((faces + vertex_offset).reshape(-1).astype("<u4"))
        vertex_offset += vertex_count

    if not positions or not indices:
        raise RuntimeError("The compiled model did not contain any mesh geometry")

    return (
        np.concatenate(positions, axis=0),
        np.concatenate(colors, axis=0),
        np.concatenate(indices, axis=0),
    )


def export_muscles(model: mujoco.MjModel, data: mujoco.MjData) -> list[dict[str, object]]:
    if model.nu != 700 or model.ntendon != 700:
        raise RuntimeError(
            f"Expected 700 actuators and tendons, found {model.nu} and {model.ntendon}"
        )

    # MuJoCo exposes wrap_xpos as (nwrap, 6) and wrap_obj as (nwrap, 2),
    # while ten_wrapadr/ten_wrapnum address individual 3D points. Flattening
    # here is essential: indexing the six-value rows would skip every other
    # point and pair unrelated tendons. This mirrors MuJoCo's visualizer, which
    # connects consecutive points and skips pulley separators.
    compiled_points = np.asarray(data.wrap_xpos, dtype=np.float64).reshape(-1, 3)
    compiled_objects = np.asarray(data.wrap_obj, dtype=np.int32).reshape(-1)

    muscles: list[dict[str, object]] = []
    for actuator_id in range(model.nu):
        tendon_id = int(model.actuator_trnid[actuator_id, 0])
        point_start = int(data.ten_wrapadr[tendon_id])
        point_count = int(data.ten_wrapnum[tendon_id])
        point_end = point_start + point_count
        if point_count < 2 or point_start < 0 or point_end > len(compiled_points):
            raise RuntimeError(
                f"Invalid compiled point range for actuator {actuator_id}: "
                f"start={point_start}, count={point_count}"
            )

        raw_points = compiled_points[point_start:point_end]
        point_objects = compiled_objects[point_start:point_end]
        if not np.isfinite(raw_points).all():
            raise RuntimeError(f"Non-finite tendon path for actuator {actuator_id}")

        segment_mask = (point_objects[:-1] != -2) & (point_objects[1:] != -2)
        raw_segments = np.stack((raw_points[:-1], raw_points[1:]), axis=1)[segment_mask]
        inside_wrap = (
            (point_objects[:-1] >= 0) & (point_objects[1:] >= 0)
        )[segment_mask]
        segments = view_coordinates(raw_segments).reshape(-1, 6)
        visible_point_mask = point_objects != -2
        points = view_coordinates(raw_points[visible_point_mask])
        point_kinds = [
            "wrap" if object_id >= 0 else "site"
            for object_id in point_objects[visible_point_mask]
        ]

        if len(segments) == 0:
            raise RuntimeError(f"Compiled tendon has no visible segment: {actuator_id}")

        muscles.append(
            {
                "index": actuator_id,
                "name": name_for(model, mujoco.mjtObj.mjOBJ_ACTUATOR, actuator_id),
                "tendon": name_for(model, mujoco.mjtObj.mjOBJ_TENDON, tendon_id),
                "region": region_for(actuator_id),
                "lengthM": round(float(data.ten_length[tendon_id]), 9),
                "points": np.round(points, 7).tolist(),
                "pointKinds": point_kinds,
                "segments": np.round(segments, 7).tolist(),
                "segmentInsideWrap": inside_wrap.tolist(),
            }
        )
    return muscles


def validate_against_native_visualizer(
    model: mujoco.MjModel,
    data: mujoco.MjData,
    muscles: list[dict[str, object]],
) -> int:
    """Require every exported segment to match MuJoCo's own tendon geoms."""
    option = mujoco.MjvOption()
    option.flags[mujoco.mjtVisFlag.mjVIS_TENDON] = True
    scene = mujoco.MjvScene(model, maxgeom=10000)
    mujoco.mjv_updateScene(
        model,
        data,
        option,
        mujoco.MjvPerturb(),
        mujoco.MjvCamera(),
        mujoco.mjtCatBit.mjCAT_ALL,
        scene,
    )

    native_by_tendon: dict[int, list[np.ndarray]] = {}
    for geom in scene.geoms[: scene.ngeom]:
        if geom.objtype != mujoco.mjtObj.mjOBJ_TENDON:
            continue
        center = np.asarray(geom.pos, dtype=np.float64)
        z_axis = np.asarray(geom.mat, dtype=np.float64).reshape(3, 3)[:, 2]
        half_length = float(geom.size[2])
        endpoints = np.stack(
            (center - z_axis * half_length, center + z_axis * half_length),
            axis=0,
        )
        native_by_tendon.setdefault(int(geom.objid), []).append(
            view_coordinates(endpoints)
        )

    checked = 0
    for muscle in muscles:
        tendon_id = mujoco.mj_name2id(
            model, mujoco.mjtObj.mjOBJ_TENDON, str(muscle["tendon"])
        )
        native_segments = native_by_tendon.get(tendon_id, [])
        exported_segments = np.asarray(
            muscle["segments"], dtype=np.float64
        ).reshape(-1, 2, 3)
        if len(native_segments) != len(exported_segments):
            raise RuntimeError(
                f"Native visualizer segment mismatch for {muscle['name']}: "
                f"native={len(native_segments)}, exported={len(exported_segments)}"
            )
        for segment_index, (exported, native) in enumerate(
            zip(exported_segments, native_segments)
        ):
            forward_error = float(np.max(np.abs(exported - native)))
            reverse_error = float(np.max(np.abs(exported - native[::-1])))
            if min(forward_error, reverse_error) > 0.000002:
                raise RuntimeError(
                    f"Native visualizer endpoint mismatch for {muscle['name']} "
                    f"segment {segment_index}"
                )
            checked += 1
    return checked


def write_geometry(path: Path, positions: np.ndarray, colors: np.ndarray, indices: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as stream:
        stream.write(MAGIC)
        stream.write(struct.pack("<II", len(positions), len(indices)))
        stream.write(np.ascontiguousarray(positions, dtype="<f4").tobytes())
        stream.write(np.ascontiguousarray(colors, dtype="<f4").tobytes())
        stream.write(np.ascontiguousarray(indices, dtype="<u4").tobytes())


def main() -> None:
    repository = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--model",
        type=Path,
        default=repository / "models" / "ms_human_700" / "MS-Human-700.xml",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=repository / "public" / "models" / "ms_human_700",
    )
    arguments = parser.parse_args()

    default_model_path = (repository / "models" / "ms_human_700" / "MS-Human-700.xml").resolve()
    model_path = arguments.model.resolve()
    if model_path != default_model_path:
        raise RuntimeError(
            "This exporter records the pinned MS-Human-700 provenance and only accepts "
            f"the vendored model at {default_model_path}; found {model_path}"
        )

    source_hash, source_file_count = source_tree_digest(model_path.parent)

    model = mujoco.MjModel.from_xml_path(str(model_path))
    data = mujoco.MjData(model)
    mujoco.mj_forward(model, data)

    positions, colors, indices = export_geometry(model, data)
    muscles = export_muscles(model, data)
    native_visualizer_segments = validate_against_native_visualizer(model, data, muscles)
    all_points = np.concatenate(
        [positions.astype(np.float64)]
        + [np.asarray(muscle["segments"], dtype=np.float64).reshape(-1, 3) for muscle in muscles],
        axis=0,
    )
    bounds_min = all_points.min(axis=0)
    bounds_max = all_points.max(axis=0)

    arguments.output.mkdir(parents=True, exist_ok=True)
    geometry_name = "default-pose.meshbin"
    write_geometry(arguments.output / geometry_name, positions, colors, indices)

    metadata = {
        "schemaVersion": 2,
        "model": {
            "name": "MS-Human-700",
            "variant": "full-body",
            "pose": "authored default pose",
            "bodies": int(model.nbody),
            "joints": int(model.njnt),
            "degreesOfFreedom": int(model.nv),
            "muscles": int(model.nu),
            "tendons": int(model.ntendon),
            "massKg": round(float(mujoco.mj_getTotalmass(model)), 6),
        },
        "geometry": {
            "url": f"/models/ms_human_700/{geometry_name}",
            "vertices": int(len(positions)),
            "triangles": int(len(indices) // 3),
            "bounds": {
                "min": np.round(bounds_min, 7).tolist(),
                "max": np.round(bounds_max, 7).tolist(),
            },
        },
        "paths": {
            "points": int(sum(len(muscle["points"]) for muscle in muscles)),
            "segments": int(sum(len(muscle["segments"]) for muscle in muscles)),
            "nativeVisualizerSegments": native_visualizer_segments,
            "wrapPoints": int(sum(
                muscle["pointKinds"].count("wrap") for muscle in muscles
            )),
            "regions": [label for _, _, label in REGIONS],
        },
        "source": {
            "package": "Google DeepMind MuJoCo Menagerie / ms_human_700",
            "upstream": "https://github.com/google-deepmind/mujoco_menagerie/tree/main/ms_human_700",
            "sourceOfTruth": "https://github.com/LNSGroup/MS-Human-700",
            "commit": SOURCE_COMMIT,
            "sourceTreeSha256": source_hash,
            "sourceFileCount": source_file_count,
            "license": "Apache-2.0",
            "licenseUrl": "/models/ms_human_700/LICENSE",
            "mujocoVersion": mujoco.__version__,
            "localCorrections": [
                "Mirrored all five LTpT_T12_l lateral coordinates to the left side.",
                "Corrected the EDCL_l-P1 lateral coordinate sign to mirror EDCL_r.",
            ],
        },
        "limitations": [
            "This is the authored default pose, not a patient-specific state.",
            "The preview displays model geometry and tendon paths; it does not estimate activation, force, pain, injury, or diagnosis.",
            "Clinical and product claims require independent anatomical, numerical, and task-specific validation.",
        ],
        "muscles": muscles,
    }
    metadata_path = arguments.output / "default-pose.json"
    metadata_path.write_text(
        json.dumps(metadata, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    print(
        json.dumps(
            {
                "model": str(model_path),
                "metadata": str(metadata_path),
                "geometry": str(arguments.output / geometry_name),
                "vertices": len(positions),
                "triangles": len(indices) // 3,
                "muscles": len(muscles),
                "pathPoints": metadata["paths"]["points"],
                "pathSegments": metadata["paths"]["segments"],
                "nativeVisualizerSegments": metadata["paths"]["nativeVisualizerSegments"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
