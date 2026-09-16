#!/usr/bin/env python3
"""Build the pinned browser assets for the articulated MS-Human right hand.

This uses the upstream manipulation variant without its bottle/table scene
geometry.  The browser profile is intentionally right-side only: the source
variant has a detailed, actuated right hand and only a visual left hand.
"""

from __future__ import annotations

import hashlib
import json
import math
import struct
from pathlib import Path

import mujoco
import numpy as np


MAGIC = b"MSHARM01"
EXPECTED_MUJOCO_VERSION = "3.10.0"
SOURCE_COMMIT = "da76818e269b82289eba39808e2fb91d679d6994"
MODEL_ID = "MS_HUMAN_700_RIGHT_HAND_STATIC_V1"

COORDINATE_LABELS = (
    ("deviation_r", "Wrist deviation"),
    ("flexion_r", "Wrist flexion"),
    ("cmc_flexion", "Thumb base flexion"),
    ("cmc_abduction", "Thumb base abduction"),
    ("mp_flexion", "Thumb knuckle flexion"),
    ("ip_flexion", "Thumb tip flexion"),
    ("2mcp_abduction", "Index spread"),
    ("2mcp_flexion", "Index knuckle flexion"),
    ("2pm_flexion", "Index middle-joint flexion"),
    ("2md_flexion", "Index tip-joint flexion"),
    ("3mcp_abduction", "Middle-finger spread"),
    ("3mcp_flexion", "Middle knuckle flexion"),
    ("3pm_flexion", "Middle middle-joint flexion"),
    ("3md_flexion", "Middle tip-joint flexion"),
    ("4cmc_flexion", "Ring-finger base flexion"),
    ("4mcp_abduction", "Ring-finger spread"),
    ("4mcp_flexion", "Ring knuckle flexion"),
    ("4pm_flexion", "Ring middle-joint flexion"),
    ("4md_flexion", "Ring tip-joint flexion"),
    ("5mcp_abduction", "Little-finger spread"),
    ("5mcp_flexion", "Little knuckle flexion"),
    ("5pm_flexion", "Little middle-joint flexion"),
    ("5md_flexion", "Little tip-joint flexion"),
)


def pose(**values: float) -> dict[str, float]:
    return values


PRESET_GROUPS = (
    {
        "id": "whole-hand",
        "label": "Whole-hand shapes",
        "presets": (
            {"id": "authored", "label": "Authored reference", "description": "The source model's authored hand posture.", "coordinates": {}},
            {"id": "open", "label": "Open hand", "description": "An unloaded open-hand reference shape.", "coordinates": pose(
                cmc_flexion=-10, cmc_abduction=8, mp_flexion=0, ip_flexion=0,
                **{"2mcp_flexion": 0, "2pm_flexion": 0, "2md_flexion": 0,
                   "3mcp_flexion": 0, "3pm_flexion": 0, "3md_flexion": 0,
                   "4cmc_flexion": 0, "4mcp_flexion": 0, "4pm_flexion": 0, "4md_flexion": 0,
                   "5mcp_flexion": 0, "5pm_flexion": 0, "5md_flexion": 0}),
            },
            {"id": "relaxed-curl", "label": "Relaxed curl", "description": "A gentle unloaded finger-curl reference shape.", "coordinates": pose(
                cmc_flexion=0, cmc_abduction=5, mp_flexion=10, ip_flexion=15,
                **{"2mcp_flexion": 20, "2pm_flexion": 25, "2md_flexion": 15,
                   "3mcp_flexion": 25, "3pm_flexion": 30, "3md_flexion": 18,
                   "4cmc_flexion": 3, "4mcp_flexion": 28, "4pm_flexion": 32, "4md_flexion": 20,
                   "5mcp_flexion": 30, "5pm_flexion": 35, "5md_flexion": 22}),
            },
            {"id": "loose-fist", "label": "Loose fist shape", "description": "An unloaded loose-fist shape; not a grip-force estimate.", "coordinates": pose(
                cmc_flexion=4, cmc_abduction=0, mp_flexion=18, ip_flexion=25,
                **{"2mcp_flexion": 35, "2pm_flexion": 42, "2md_flexion": 26,
                   "3mcp_flexion": 38, "3pm_flexion": 45, "3md_flexion": 28,
                   "4cmc_flexion": 4, "4mcp_flexion": 40, "4pm_flexion": 48, "4md_flexion": 30,
                   "5mcp_flexion": 42, "5pm_flexion": 50, "5md_flexion": 32}),
            },
            {"id": "spread", "label": "Finger spread", "description": "An unloaded finger-abduction reference shape.", "coordinates": pose(
                cmc_flexion=-5, cmc_abduction=12,
                **{"2mcp_abduction": 12, "3mcp_abduction": 5, "4mcp_abduction": -5, "5mcp_abduction": -12,
                   "2mcp_flexion": 0, "3mcp_flexion": 0, "4mcp_flexion": 0, "5mcp_flexion": 0}),
            },
        ),
    },
    {
        "id": "functional-shapes",
        "label": "Functional shapes",
        "presets": (
            {"id": "point", "label": "Pointing shape", "description": "Index extended with the other fingers curled; no external load.", "coordinates": pose(
                cmc_flexion=2, cmc_abduction=5, mp_flexion=12, ip_flexion=18,
                **{"2mcp_flexion": 0, "2pm_flexion": 0, "2md_flexion": 0,
                   "3mcp_flexion": 55, "3pm_flexion": 70, "3md_flexion": 45,
                   "4cmc_flexion": 6, "4mcp_flexion": 60, "4pm_flexion": 75, "4md_flexion": 50,
                   "5mcp_flexion": 65, "5pm_flexion": 78, "5md_flexion": 52}),
            },
            {"id": "opposition", "label": "Thumb opposition", "description": "Thumb opposition reference without object contact.", "coordinates": pose(
                cmc_flexion=12, cmc_abduction=-18, mp_flexion=25, ip_flexion=30,
                **{"2mcp_flexion": 15, "2pm_flexion": 20, "2md_flexion": 10}),
            },
            {"id": "pinch", "label": "Pinch shape", "description": "Thumb-to-index shape without contact or pinch-force estimation.", "coordinates": pose(
                cmc_flexion=12, cmc_abduction=-15, mp_flexion=28, ip_flexion=38,
                **{"2mcp_flexion": 35, "2pm_flexion": 45, "2md_flexion": 25,
                   "3mcp_flexion": 18, "3pm_flexion": 22, "3md_flexion": 12,
                   "4cmc_flexion": 3, "4mcp_flexion": 20, "4pm_flexion": 25, "4md_flexion": 15,
                   "5mcp_flexion": 22, "5pm_flexion": 28, "5md_flexion": 18}),
            },
        ),
    },
)


def name_for(model: mujoco.MjModel, kind: mujoco.mjtObj, index: int) -> str:
    return mujoco.mj_id2name(model, kind, index) or f"unnamed_{index}"


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


def source_tree_digest(source_root: Path) -> tuple[str, int]:
    files = sorted((path for path in source_root.rglob("*") if path.is_file() and path.name != "SOURCE.md"), key=lambda path: path.relative_to(source_root).as_posix())
    digest = hashlib.sha256()
    for path in files:
        digest.update(path.relative_to(source_root).as_posix().encode())
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest(), len(files)


def path_body_ids(model: mujoco.MjModel, tendon_id: int) -> list[int]:
    result: set[int] = set()
    start = int(model.tendon_adr[tendon_id])
    for wrap_index in range(start, start + int(model.tendon_num[tendon_id])):
        wrap_type = int(model.wrap_type[wrap_index])
        object_id = int(model.wrap_objid[wrap_index])
        if wrap_type == int(mujoco.mjtWrap.mjWRAP_SITE):
            result.add(int(model.site_bodyid[object_id]))
        elif wrap_type in (int(mujoco.mjtWrap.mjWRAP_SPHERE), int(mujoco.mjtWrap.mjWRAP_CYLINDER)):
            result.add(int(model.geom_bodyid[object_id]))
        elif wrap_type == int(mujoco.mjtWrap.mjWRAP_JOINT):
            result.add(int(model.jnt_bodyid[object_id]))
    return sorted(result)


def hand_actuators(model: mujoco.MjModel, hand_bodies: set[int]) -> list[int]:
    result = []
    for actuator_id in range(model.nu):
        if int(model.actuator_trntype[actuator_id]) != int(mujoco.mjtTrn.mjTRN_TENDON):
            continue
        tendon_id = int(model.actuator_trnid[actuator_id, 0])
        if hand_bodies.intersection(path_body_ids(model, tendon_id)):
            result.append(actuator_id)
    if len(result) != 44:
        raise RuntimeError(f"Expected 44 hand actuators, found {len(result)}")
    return result


def write_geometry(model: mujoco.MjModel, data: mujoco.MjData, human_bodies: set[int], hand_bodies: set[int], path: Path) -> tuple[list[dict], int, int, list[list[float]]]:
    positions: list[np.ndarray] = []
    indices: list[np.ndarray] = []
    geoms: list[dict] = []
    world_points: list[np.ndarray] = []
    vertex_offset = 0
    index_offset = 0
    for geom_id in range(model.ngeom):
        if int(model.geom_type[geom_id]) != int(mujoco.mjtGeom.mjGEOM_MESH):
            continue
        body_id = int(model.geom_bodyid[geom_id])
        if body_id not in human_bodies:
            continue
        mesh_id = int(model.geom_dataid[geom_id])
        vertex_start = int(model.mesh_vertadr[mesh_id])
        vertex_count = int(model.mesh_vertnum[mesh_id])
        face_start = int(model.mesh_faceadr[mesh_id])
        face_count = int(model.mesh_facenum[mesh_id])
        local = np.asarray(model.mesh_vert[vertex_start:vertex_start + vertex_count], dtype=np.float64)
        local_indices = np.asarray(model.mesh_face[face_start:face_start + face_count], dtype=np.uint32).reshape(-1)
        geom_rotation = np.asarray(data.geom_xmat[geom_id]).reshape(3, 3)
        geom_position = np.asarray(data.geom_xpos[geom_id])
        world = local @ geom_rotation.T + geom_position
        body_rotation = np.asarray(data.xmat[body_id]).reshape(3, 3)
        body_position = np.asarray(data.xpos[body_id])
        body_local = (world - body_position) @ body_rotation
        positions.append(body_local.astype("<f4"))
        indices.append(local_indices.astype("<u4"))
        world_points.append(np.stack((world[:, 0], world[:, 2], -world[:, 1]), axis=-1))
        geoms.append({
            "geomId": geom_id,
            "name": name_for(model, mujoco.mjtObj.mjOBJ_GEOM, geom_id),
            "bodyId": body_id,
            "body": name_for(model, mujoco.mjtObj.mjOBJ_BODY, body_id),
            "role": "arm" if body_id in hand_bodies else "context",
            "vertexStart": vertex_offset,
            "vertexCount": vertex_count,
            "indexStart": index_offset,
            "indexCount": len(local_indices),
            "rgba": np.round(model.geom_rgba[geom_id], 6).tolist(),
        })
        vertex_offset += vertex_count
        index_offset += len(local_indices)
    all_positions = np.concatenate(positions).astype("<f4")
    all_indices = np.concatenate(indices).astype("<u4")
    with path.open("wb") as stream:
        stream.write(MAGIC)
        stream.write(struct.pack("<II", len(all_positions), len(all_indices)))
        stream.write(all_positions.tobytes())
        stream.write(all_indices.tobytes())
    fit = np.concatenate(world_points)
    return geoms, len(all_positions), len(all_indices) // 3, [fit.min(axis=0).tolist(), fit.max(axis=0).tolist()]


def equality_dependents(model: mujoco.MjModel, joint_id: int) -> list[dict]:
    result = []
    for equality_id in range(model.neq):
        if int(model.eq_type[equality_id]) != int(mujoco.mjtEq.mjEQ_JOINT):
            continue
        if int(model.eq_obj2id[equality_id]) != joint_id:
            continue
        dependent_id = int(model.eq_obj1id[equality_id])
        result.append({"equalityId": equality_id, "jointId": dependent_id, "name": name_for(model, mujoco.mjtObj.mjOBJ_JOINT, dependent_id)})
    return result


def canonical(value):
    if isinstance(value, dict):
        return {key: canonical(value[key]) for key in sorted(value)}
    if isinstance(value, (list, tuple)):
        return [canonical(item) for item in value]
    # Match JSON.parse/JSON.stringify in the browser (0.0 becomes 0) so the
    # worker can independently reproduce the manifest digest.
    if isinstance(value, float) and math.isfinite(value) and value.is_integer():
        return int(value)
    return value


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_text_lf(path: Path, value: str) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as stream:
        stream.write(value)


def main() -> None:
    repository = Path(__file__).resolve().parents[1]
    model_path = repository / "models" / "ms_human_700" / "MS-Human-700-Manipulation.xml"
    output = repository / "public" / "models" / "ms_human_700"
    if mujoco.__version__ != EXPECTED_MUJOCO_VERSION:
        raise RuntimeError(f"MuJoCo {EXPECTED_MUJOCO_VERSION} required, found {mujoco.__version__}")
    model = mujoco.MjModel.from_xml_path(str(model_path))
    data = mujoco.MjData(model)
    mujoco.mj_resetDataKeyframe(model, data, 0)
    mujoco.mj_forward(model, data)
    human_bodies = descendants(model, "pelvis")
    hand_bodies = descendants(model, "proximal_row")
    actuator_ids = hand_actuators(model, hand_bodies)

    geometry_path = output / "right-hand.meshbin"
    runtime_path = output / "right-hand-runtime.mjb"
    metadata_path = output / "right-hand.json"
    manifest_path = output / "hand-region.json"
    geoms, vertex_count, triangle_count, fit = write_geometry(model, data, human_bodies, hand_bodies, geometry_path)

    spec = mujoco.MjSpec.from_file(str(model_path))
    spec.compiler.discardvisual = 1
    runtime = spec.compile()
    mujoco.mj_saveModel(runtime, str(runtime_path))
    runtime_data = mujoco.MjData(runtime)
    mujoco.mj_resetDataKeyframe(runtime, runtime_data, 0)
    mujoco.mj_forward(runtime, runtime_data)
    for field in ("nq", "nv", "nu", "na", "ntendon", "neq", "nbody"):
        if getattr(model, field) != getattr(runtime, field):
            raise RuntimeError(f"Runtime changed {field}")

    coordinates = []
    for name, label in COORDINATE_LABELS:
        joint_id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, name)
        qpos_address = int(model.jnt_qposadr[joint_id])
        coordinates.append({
            "name": name,
            "engineName": name,
            "label": label,
            "jointId": joint_id,
            "qposAddress": qpos_address,
            "dofAddress": int(model.jnt_dofadr[joint_id]),
            "minimumDegrees": round(math.degrees(float(model.jnt_range[joint_id, 0])), 4),
            "maximumDegrees": round(math.degrees(float(model.jnt_range[joint_id, 1])), 4),
            "defaultDegrees": round(math.degrees(float(data.qpos[qpos_address])), 4),
            "equalityDependents": equality_dependents(model, joint_id),
        })

    muscles = []
    for actuator_id in actuator_ids:
        name = name_for(model, mujoco.mjtObj.mjOBJ_ACTUATOR, actuator_id)
        tendon_id = int(model.actuator_trnid[actuator_id, 0])
        intrinsic = actuator_id >= 61
        muscles.append({
            "actuatorId": actuator_id,
            "name": name,
            "tendonId": tendon_id,
            "tendon": name_for(model, mujoco.mjtObj.mjOBJ_TENDON, tendon_id),
            "group": "Intrinsic hand" if intrinsic else "Wrist and digit mover",
            "visibleByDefault": True,
            "pathBodyIds": path_body_ids(model, tendon_id),
        })

    source_hash, source_count = source_tree_digest(model_path.parent)
    metadata = {
        "schemaVersion": 1,
        "model": {"name": "MS-Human-700", "variant": "manipulation / articulated right hand", "runtime": "MuJoCo 3.10.0 WebAssembly", "totalMuscles": model.nu, "functionalMuscles": len(muscles), "armBodies": len(hand_bodies), "independentCoordinates": len(coordinates)},
        "coordinates": coordinates,
        "presets": [preset for group in PRESET_GROUPS for preset in group["presets"]],
        "geometry": {"url": "./models/ms_human_700/right-hand.meshbin", "geoms": geoms, "vertices": vertex_count, "triangles": triangle_count, "fitBounds": {"min": fit[0], "max": fit[1]}},
        "runtime": {"url": "./models/ms_human_700/right-hand-runtime.mjb", "mujocoModule": "./vendor/mujoco.js", "mujocoWasm": "./vendor/mujoco.wasm"},
        "muscles": muscles,
        "staticHold": {"gravityMPerS2": [0, 0, -9.81], "reserveObjectiveWeightPerNm2": 2500, "maximumResidualNm": 0.0001, "maximumReserveNm": 0.05, "capacityActivation": 0.995, "capacityReserveNm": 0.01, "assumptions": ["Generic, non-patient-specific MS-Human-700 manipulation anatomy and parameters.", "Static posture: zero velocity and zero acceleration.", "Gravity and model self-weight only; no object contact, grip target, or external force.", "The forearm and all non-selected model coordinates are fixed support.", "Authored passive muscle and joint forces are included.", "Activations are withheld when equilibrium or reserve checks fail."]},
        "source": {"package": "MS-Human-700 manipulation variant", "sourceOfTruth": "https://github.com/LNSGroup/MS-Human-700", "commit": SOURCE_COMMIT, "sourceTreeSha256": source_hash, "sourceFileCount": source_count, "modelLicense": "Apache-2.0", "runtimeLicense": "Apache-2.0", "mujocoVersion": mujoco.__version__, "localCorrections": ["The same documented source-tree corrections used by the primary profile are present."]},
        "validation": {"runtimeGeoms": runtime.ngeom, "runtimeMeshes": runtime.nmesh, "handBodies": len(hand_bodies), "handMuscles": len(muscles), "handCoordinates": len(coordinates)},
    }
    write_text_lf(metadata_path, json.dumps(metadata, ensure_ascii=False, separators=(",", ":")))

    runtime_hash = sha256(runtime_path)
    geometry_hash = sha256(geometry_path)
    region = {
        "id": "right-hand", "label": "Right hand", "presentationName": "Right hand", "description": "Detailed articulated right-hand profile from the MS-Human-700 manipulation variant.", "area": "hand", "laterality": "right", "calculationSide": "right", "status": "data-ready",
        "activeBodyIds": sorted(hand_bodies),
        "activeBodies": [{"bodyId": body_id, "name": name_for(model, mujoco.mjtObj.mjOBJ_BODY, body_id), "parentBodyId": int(model.body_parentid[body_id])} for body_id in sorted(hand_bodies)],
        "coordinates": coordinates,
        "candidateMuscles": muscles,
        "defaultSelectedMuscle": {"actuatorId": 63, "name": "OPP"},
        "presetGroups": PRESET_GROUPS,
        "assessment": {"supported": False, "reason": "No versioned hand assessment protocol is provided."},
        "semantics": {
            "fixedSupport": "The radius/forearm and all non-selected model coordinates remain prescribed at the authored manipulation keyframe; their support reactions are not interpreted.",
            "supportDescription": "The radius/forearm and all non-selected model coordinates remain prescribed at the authored manipulation keyframe. No object contact, grip target, or external load is applied.",
            "equilibrium": "Static equilibrium is solved only for the selected wrist and finger coordinates.",
            "externalLoad": "none", "contact": "none", "gravityMPerS2": [0, 0, -9.81], "clinicalValidation": False,
            "assumptions": metadata["staticHold"]["assumptions"],
            "interpretationBoundary": "An unloaded hand-shape and muscle-demand estimate; not grip force, pinch force, tissue load, pain evidence, or diagnosis.",
        },
    }
    manifest_without_digest = {
        "schemaVersion": 1, "manifestId": "MS_HUMAN_700_HAND_REGION_MANIFEST_V1", "defaultRegionId": "right-hand", "generatedAt": None,
        "model": {"modelId": MODEL_ID, "name": "MS-Human-700", "variant": "manipulation", "sourceTreeSha256": source_hash, "sourceCommit": SOURCE_COMMIT, "mujocoVersion": mujoco.__version__, "runtime": {"url": "./models/ms_human_700/right-hand-runtime.mjb", "sha256": runtime_hash}, "geometry": {"url": "./models/ms_human_700/right-hand.meshbin", "sha256": geometry_hash}},
        "compatibility": {}, "regions": [region],
    }
    content_digest = hashlib.sha256(json.dumps(canonical(manifest_without_digest), ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
    manifest = {**manifest_without_digest, "contentDigestSha256": content_digest}
    write_text_lf(manifest_path, json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"metadataSha256": sha256(metadata_path), "manifestSha256": sha256(manifest_path), "manifestContentDigest": content_digest, "geometrySha256": geometry_hash, "runtimeSha256": runtime_hash, "coordinates": len(coordinates), "muscles": len(muscles), "handBodies": len(hand_bodies), "geoms": len(geoms), "vertices": vertex_count, "triangles": triangle_count}, indent=2))


if __name__ == "__main__":
    main()
