#!/usr/bin/env python3
"""Build the exact, articulated MS-Human right-arm browser assets.

The browser uses two complementary artifacts:

* ``right-arm.meshbin`` keeps the selected bone meshes in geom-local space so
  Three.js can articulate them from MuJoCo's live ``geom_xpos``/``geom_xmat``.
* ``right-arm-runtime.mjb`` omits visual-only meshes but retains the complete
  model mechanics, muscle wrapping, passive forces, and authored equalities.

The latter is intentionally compiled with the same pinned MuJoCo version used
by the browser runtime.  Regenerate both files together when that version or
the vendored source changes.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import struct
from pathlib import Path

import mujoco
import numpy as np


MAGIC = b"MSHARM01"
SOURCE_COMMIT = "da76818e269b82289eba39808e2fb91d679d6994"
EXPECTED_MUJOCO_VERSION = "3.10.0"
EXPECTED_FUNCTIONAL_MUSCLES = 88

COORDINATES = (
    ("elv_angle_r", "Shoulder elevation plane"),
    ("shoulder_elv_r", "Shoulder elevation"),
    ("shoulder_rot_r", "Shoulder rotation"),
    ("elbow_flexion_r", "Elbow flexion"),
    ("pro_sup_r", "Forearm rotation"),
    ("deviation_r", "Wrist deviation"),
    ("flexion_r", "Wrist flexion"),
)

ARM_ROOT = "clavicle_r"
CONTEXT_BODIES = {
    "sternum",
    *(f"thoracic{number}" for number in range(1, 13)),
    *(f"rib{number}_R" for number in range(1, 13)),
}
CONTEXT_HEAD_GEOMS = {
    "rotatedcerv7",
    "cerv6",
    "cerv5",
    "cerv4",
    "cerv3",
    "cerv2",
    "cerv1",
}

PRESETS = (
    {
        "id": "neutral",
        "label": "Arm relaxed",
        "description": "Authored neutral arm posture",
        "coordinates": {},
    },
    {
        "id": "forward",
        "label": "Reach forward",
        "description": "Moderate forward reach with a slightly bent elbow",
        "coordinates": {
            "elv_angle_r": 90,
            "shoulder_elv_r": 45,
            "elbow_flexion_r": 30,
        },
    },
    {
        "id": "mouth",
        "label": "Hand to mouth",
        "description": "Flexed elbow and supinated forearm",
        "coordinates": {
            "elv_angle_r": 90,
            "shoulder_elv_r": 35,
            "elbow_flexion_r": 120,
            "pro_sup_r": -45,
        },
    },
    {
        "id": "overhead",
        "label": "Overhead reach",
        "description": "Raised arm with coupled scapular rotation",
        "coordinates": {
            "elv_angle_r": 30,
            "shoulder_elv_r": 120,
            "shoulder_rot_r": -35,
            "elbow_flexion_r": 110,
        },
    },
)


def name_for(model: mujoco.MjModel, object_type: mujoco.mjtObj, index: int) -> str:
    return mujoco.mj_id2name(model, object_type, index) or f"unnamed_{index}"


def view_coordinates(values: np.ndarray) -> np.ndarray:
    """Rotate MuJoCo's Z-up coordinates into the preview's Y-up frame."""
    return np.stack((values[..., 0], values[..., 2], -values[..., 1]), axis=-1)


def source_tree_digest(source_root: Path) -> tuple[str, int]:
    files = sorted(
        (
            path
            for path in source_root.rglob("*")
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


def descendants(model: mujoco.MjModel, root_name: str) -> set[int]:
    root = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, root_name)
    if root < 0:
        raise RuntimeError(f"Body not found: {root_name}")
    result: set[int] = set()
    for body_id in range(model.nbody):
        current = body_id
        while current > 0 and current != root:
            current = int(model.body_parentid[current])
        if current == root:
            result.add(body_id)
    return result


def tendon_touches_bodies(
    model: mujoco.MjModel, tendon_id: int, body_ids: set[int]
) -> bool:
    start = int(model.tendon_adr[tendon_id])
    end = start + int(model.tendon_num[tendon_id])
    for wrap_index in range(start, end):
        wrap_type = int(model.wrap_type[wrap_index])
        object_id = int(model.wrap_objid[wrap_index])
        if wrap_type == int(mujoco.mjtWrap.mjWRAP_SITE):
            body_id = int(model.site_bodyid[object_id])
        elif wrap_type in (
            int(mujoco.mjtWrap.mjWRAP_SPHERE),
            int(mujoco.mjtWrap.mjWRAP_CYLINDER),
        ):
            body_id = int(model.geom_bodyid[object_id])
        elif wrap_type == int(mujoco.mjtWrap.mjWRAP_JOINT):
            body_id = int(model.jnt_bodyid[object_id])
        else:
            continue
        if body_id in body_ids:
            return True
    return False


def functional_actuators(model: mujoco.MjModel, arm_bodies: set[int]) -> list[int]:
    actuator_ids: list[int] = []
    for actuator_id in range(model.nu):
        if int(model.actuator_trntype[actuator_id]) != int(
            mujoco.mjtTrn.mjTRN_TENDON
        ):
            continue
        tendon_id = int(model.actuator_trnid[actuator_id, 0])
        if tendon_touches_bodies(model, tendon_id, arm_bodies):
            actuator_ids.append(actuator_id)
    if len(actuator_ids) != EXPECTED_FUNCTIONAL_MUSCLES:
        raise RuntimeError(
            "Right-arm functional muscle inventory changed: expected "
            f"{EXPECTED_FUNCTIONAL_MUSCLES}, found {len(actuator_ids)}"
        )
    return actuator_ids


def group_for(actuator_id: int, name: str) -> tuple[str, bool]:
    if name.startswith("LD_"):
        return "Long torso origin", False
    if 100 <= actuator_id < 161:
        return "Arm", True
    return "Shoulder stabilizer", True


def selected_mesh_geoms(
    model: mujoco.MjModel, arm_bodies: set[int]
) -> list[tuple[int, str]]:
    selected: list[tuple[int, str]] = []
    for geom_id in range(model.ngeom):
        if int(model.geom_type[geom_id]) != int(mujoco.mjtGeom.mjGEOM_MESH):
            continue
        body_id = int(model.geom_bodyid[geom_id])
        body_name = name_for(model, mujoco.mjtObj.mjOBJ_BODY, body_id)
        geom_name = name_for(model, mujoco.mjtObj.mjOBJ_GEOM, geom_id)
        if body_id in arm_bodies:
            selected.append((geom_id, "arm"))
        elif body_name in CONTEXT_BODIES or geom_name in CONTEXT_HEAD_GEOMS:
            selected.append((geom_id, "context"))
    return selected


def export_local_geometry(
    model: mujoco.MjModel,
    data: mujoco.MjData,
    selected: list[tuple[int, str]],
) -> tuple[np.ndarray, np.ndarray, list[dict[str, object]], np.ndarray]:
    positions: list[np.ndarray] = []
    indices: list[np.ndarray] = []
    descriptors: list[dict[str, object]] = []
    default_world_vertices: list[np.ndarray] = []
    vertex_offset = 0
    index_offset = 0

    for geom_id, role in selected:
        mesh_id = int(model.geom_dataid[geom_id])
        vertex_start = int(model.mesh_vertadr[mesh_id])
        vertex_count = int(model.mesh_vertnum[mesh_id])
        face_start = int(model.mesh_faceadr[mesh_id])
        face_count = int(model.mesh_facenum[mesh_id])
        local_vertices = np.asarray(
            model.mesh_vert[vertex_start : vertex_start + vertex_count],
            dtype=np.float32,
        ).copy()
        local_indices = np.asarray(
            model.mesh_face[face_start : face_start + face_count],
            dtype=np.uint32,
        ).reshape(-1).copy()

        rotation = np.asarray(data.geom_xmat[geom_id], dtype=np.float64).reshape(3, 3)
        translation = np.asarray(data.geom_xpos[geom_id], dtype=np.float64)
        world = local_vertices.astype(np.float64) @ rotation.T + translation
        default_world_vertices.append(view_coordinates(world))

        body_id = int(model.geom_bodyid[geom_id])
        body_rotation = np.asarray(data.xmat[body_id], dtype=np.float64).reshape(3, 3)
        body_translation = np.asarray(data.xpos[body_id], dtype=np.float64)
        # Visual mesh geoms are removed from the compact runtime model.  Bake
        # their fixed geom-to-body offset into the vertices, then articulate
        # each piece from the body's live transform (body IDs remain stable).
        body_local_vertices = (world - body_translation) @ body_rotation
        rgba = np.asarray(model.geom_rgba[geom_id], dtype=np.float64)
        descriptors.append(
            {
                "geomId": geom_id,
                "name": name_for(model, mujoco.mjtObj.mjOBJ_GEOM, geom_id),
                "bodyId": body_id,
                "body": name_for(model, mujoco.mjtObj.mjOBJ_BODY, body_id),
                "role": role,
                "vertexStart": vertex_offset,
                "vertexCount": vertex_count,
                "indexStart": index_offset,
                "indexCount": len(local_indices),
                "rgba": np.round(rgba, 6).tolist(),
            }
        )
        positions.append(body_local_vertices.astype(np.float32))
        indices.append(local_indices)
        vertex_offset += vertex_count
        index_offset += len(local_indices)

    return (
        np.concatenate(positions, axis=0).astype("<f4"),
        np.concatenate(indices, axis=0).astype("<u4"),
        descriptors,
        np.concatenate(default_world_vertices, axis=0),
    )


def write_geometry(path: Path, positions: np.ndarray, indices: np.ndarray) -> None:
    with path.open("wb") as stream:
        stream.write(MAGIC)
        stream.write(struct.pack("<II", len(positions), len(indices)))
        stream.write(np.ascontiguousarray(positions, dtype="<f4").tobytes())
        stream.write(np.ascontiguousarray(indices, dtype="<u4").tobytes())


def default_visible_path_points(
    model: mujoco.MjModel,
    data: mujoco.MjData,
    muscles: list[dict[str, object]],
) -> np.ndarray:
    compiled_points = np.asarray(data.wrap_xpos, dtype=np.float64).reshape(-1, 3)
    compiled_objects = np.asarray(data.wrap_obj, dtype=np.int32).reshape(-1)
    visible: list[np.ndarray] = []
    for muscle in muscles:
        if not muscle["visibleByDefault"]:
            continue
        tendon_id = int(muscle["tendonId"])
        start = int(data.ten_wrapadr[tendon_id])
        count = int(data.ten_wrapnum[tendon_id])
        points = compiled_points[start : start + count]
        objects = compiled_objects[start : start + count]
        visible.append(view_coordinates(points[objects != -2]))
    return np.concatenate(visible, axis=0)


def make_runtime_model(model_path: Path) -> mujoco.MjModel:
    spec = mujoco.MjSpec.from_file(str(model_path))
    spec.compiler.discardvisual = 1
    return spec.compile()


def validate_runtime(
    full_model: mujoco.MjModel,
    full_data: mujoco.MjData,
    runtime_model: mujoco.MjModel,
    actuator_ids: list[int],
) -> dict[str, float | int]:
    runtime_data = mujoco.MjData(runtime_model)
    mujoco.mj_resetDataKeyframe(runtime_model, runtime_data, 0)
    mujoco.mj_forward(runtime_model, runtime_data)

    for field in ("nq", "nv", "nu", "na", "ntendon", "neq"):
        if getattr(full_model, field) != getattr(runtime_model, field):
            raise RuntimeError(f"Runtime changed model field {field}")

    tendon_ids = np.asarray(
        [full_model.actuator_trnid[index, 0] for index in actuator_ids],
        dtype=np.int32,
    )
    length_error = float(
        np.max(
            np.abs(
                np.asarray(full_data.ten_length)[tendon_ids]
                - np.asarray(runtime_data.ten_length)[tendon_ids]
            )
        )
    )
    bias_error = float(
        np.max(np.abs(np.asarray(full_data.qfrc_bias) - runtime_data.qfrc_bias))
    )
    passive_error = float(
        np.max(np.abs(np.asarray(full_data.qfrc_passive) - runtime_data.qfrc_passive))
    )
    if max(length_error, bias_error, passive_error) > 1e-9:
        raise RuntimeError(
            "Visual-free runtime changed mechanics: "
            f"length={length_error}, bias={bias_error}, passive={passive_error}"
        )
    return {
        "maximumDefaultTendonLengthErrorM": length_error,
        "maximumDefaultBiasForceError": bias_error,
        "maximumDefaultPassiveForceError": passive_error,
        "runtimeGeoms": int(runtime_model.ngeom),
        "runtimeMeshes": int(runtime_model.nmesh),
    }


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

    model_path = arguments.model.resolve()
    expected_path = (
        repository / "models" / "ms_human_700" / "MS-Human-700.xml"
    ).resolve()
    if model_path != expected_path:
        raise RuntimeError(f"Only the pinned vendored model is accepted: {expected_path}")
    if mujoco.__version__ != EXPECTED_MUJOCO_VERSION:
        raise RuntimeError(
            f"MuJoCo {EXPECTED_MUJOCO_VERSION} is required; found {mujoco.__version__}"
        )

    model = mujoco.MjModel.from_xml_path(str(model_path))
    data = mujoco.MjData(model)
    mujoco.mj_resetDataKeyframe(model, data, 0)
    mujoco.mj_forward(model, data)
    arm_bodies = descendants(model, ARM_ROOT)
    actuator_ids = functional_actuators(model, arm_bodies)
    selected_geoms = selected_mesh_geoms(model, arm_bodies)

    positions, indices, geoms, default_vertices = export_local_geometry(
        model, data, selected_geoms
    )
    muscles: list[dict[str, object]] = []
    for actuator_id in actuator_ids:
        name = name_for(model, mujoco.mjtObj.mjOBJ_ACTUATOR, actuator_id)
        tendon_id = int(model.actuator_trnid[actuator_id, 0])
        group, visible = group_for(actuator_id, name)
        muscles.append(
            {
                "actuatorId": actuator_id,
                "name": name,
                "tendonId": tendon_id,
                "tendon": name_for(model, mujoco.mjtObj.mjOBJ_TENDON, tendon_id),
                "group": group,
                "visibleByDefault": visible,
            }
        )

    path_points = default_visible_path_points(model, data, muscles)
    fit_points = np.concatenate((default_vertices, path_points), axis=0)
    fit_min = fit_points.min(axis=0)
    fit_max = fit_points.max(axis=0)

    runtime_model = make_runtime_model(model_path)
    validation = validate_runtime(model, data, runtime_model, actuator_ids)
    source_hash, source_file_count = source_tree_digest(model_path.parent)

    output = arguments.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    geometry_name = "right-arm.meshbin"
    runtime_name = "right-arm-runtime.mjb"
    metadata_name = "right-arm.json"
    write_geometry(output / geometry_name, positions, indices)
    mujoco.mj_saveModel(runtime_model, str(output / runtime_name))

    coordinates: list[dict[str, object]] = []
    for name, label in COORDINATES:
        joint_id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, name)
        minimum, maximum = map(float, model.jnt_range[joint_id])
        coordinates.append(
            {
                "name": name,
                "label": label,
                "jointId": joint_id,
                "qposAddress": int(model.jnt_qposadr[joint_id]),
                "dofAddress": int(model.jnt_dofadr[joint_id]),
                "minimumDegrees": round(math.degrees(minimum), 4),
                "maximumDegrees": round(math.degrees(maximum), 4),
                "defaultDegrees": 0,
            }
        )

    metadata = {
        "schemaVersion": 1,
        "model": {
            "name": "MS-Human-700",
            "variant": "primary / right-arm static posture prototype",
            "runtime": "MuJoCo 3.10.0 WebAssembly",
            "totalMuscles": int(model.nu),
            "functionalMuscles": len(muscles),
            "armBodies": len(arm_bodies),
            "independentCoordinates": len(COORDINATES),
        },
        "coordinates": coordinates,
        "presets": PRESETS,
        "geometry": {
            "url": f"/models/ms_human_700/{geometry_name}",
            "geoms": geoms,
            "vertices": int(len(positions)),
            "triangles": int(len(indices) // 3),
            "fitBounds": {
                "min": np.round(fit_min, 7).tolist(),
                "max": np.round(fit_max, 7).tolist(),
            },
        },
        "runtime": {
            "url": f"/models/ms_human_700/{runtime_name}",
            "mujocoModule": "/vendor/mujoco.js",
            "mujocoWasm": "/vendor/mujoco.wasm",
        },
        "muscles": muscles,
        "staticHold": {
            "gravityMPerS2": [0, 0, -9.81],
            "reserveObjectiveWeightPerNm2": 2500,
            "maximumResidualNm": 0.0001,
            "maximumReserveNm": 0.05,
            "capacityActivation": 0.995,
            "capacityReserveNm": 0.01,
            "assumptions": [
                "Generic, non-patient-specific MS-Human-700 anatomy and parameters.",
                "Static posture: zero velocity and zero acceleration.",
                "Gravity and model self-weight only; no hand load, contact, or external force.",
                "Pelvis, legs, torso, head, and left arm are treated as fixed support.",
                "Authored passive muscle and joint forces are included.",
                "Activations are withheld when equilibrium or reserve checks fail.",
            ],
        },
        "source": {
            "package": "Google DeepMind MuJoCo Menagerie / ms_human_700",
            "sourceOfTruth": "https://github.com/LNSGroup/MS-Human-700",
            "commit": SOURCE_COMMIT,
            "sourceTreeSha256": source_hash,
            "sourceFileCount": source_file_count,
            "modelLicense": "Apache-2.0",
            "runtimeLicense": "Apache-2.0",
            "mujocoVersion": mujoco.__version__,
            "localCorrections": [
                "Mirrored all five LTpT_T12_l lateral coordinates to the left side.",
                "Corrected the EDCL_l-P1 lateral coordinate sign to mirror EDCL_r.",
            ],
        },
        "validation": validation,
    }
    (output / metadata_name).write_text(
        json.dumps(metadata, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "metadata": str(output / metadata_name),
                "geometry": str(output / geometry_name),
                "runtime": str(output / runtime_name),
                "functionalMuscles": len(muscles),
                "armGeoms": sum(item["role"] == "arm" for item in geoms),
                "contextGeoms": sum(item["role"] == "context" for item in geoms),
                "triangles": int(len(indices) // 3),
                "validation": validation,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
