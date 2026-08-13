#!/usr/bin/env python3
"""Validate the MS-Human-700 right-arm static-equilibrium formulation.

This is a development/verification tool for the C++ web implementation. It
uses the same seven independent arm coordinates, reduces the authored joint
equalities by virtual work, includes passive muscle force, and solves a bounded
minimum-squared-activation equilibrium with small reserve torques.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import mujoco
import numpy as np


COORDINATES = (
    ("elv_angle_r", "Plane of shoulder elevation"),
    ("shoulder_elv_r", "Shoulder elevation"),
    ("shoulder_rot_r", "Shoulder axial rotation"),
    ("elbow_flexion_r", "Elbow flexion"),
    ("pro_sup_r", "Forearm pronation / supination"),
    ("deviation_r", "Wrist deviation"),
    ("flexion_r", "Wrist flexion"),
)
RESERVE_CAPACITY_NM = 0.5
RESERVE_OBJECTIVE_WEIGHT = 625.0


def object_name(model: mujoco.MjModel, kind: mujoco.mjtObj, index: int) -> str:
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


def arm_actuators(model: mujoco.MjModel, body_ids: set[int]) -> list[int]:
    result: list[int] = []
    for actuator_id in range(model.nu):
        if int(model.actuator_trntype[actuator_id]) != int(mujoco.mjtTrn.mjTRN_TENDON):
            continue
        tendon_id = int(model.actuator_trnid[actuator_id, 0])
        if tendon_touches_bodies(model, tendon_id, body_ids):
            result.append(actuator_id)
    return result


def evaluate_polynomial(coefficients: np.ndarray, value: float) -> tuple[float, float]:
    result = 0.0
    derivative = 0.0
    power = 1.0
    for degree, coefficient in enumerate(coefficients[:5]):
        result += float(coefficient) * power
        if degree:
            derivative += degree * float(coefficient) * (value ** (degree - 1))
        power *= value
    return result, derivative


def set_pose(
    model: mujoco.MjModel,
    data: mujoco.MjData,
    requested_degrees: dict[str, float],
) -> tuple[np.ndarray, np.ndarray]:
    if model.nkey:
        mujoco.mj_resetDataKeyframe(model, data, 0)
    else:
        mujoco.mj_resetData(model, data)

    independent_joints: list[int] = []
    independent_dofs: list[int] = []
    for name, _ in COORDINATES:
        joint_id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, name)
        value = math.radians(requested_degrees.get(name, 0.0))
        minimum, maximum = map(float, model.jnt_range[joint_id])
        if value < minimum - 1e-10 or value > maximum + 1e-10:
            raise ValueError(
                f"{name}={requested_degrees.get(name, 0.0)} degrees is outside "
                f"[{math.degrees(minimum):.2f}, {math.degrees(maximum):.2f}]"
            )
        data.qpos[int(model.jnt_qposadr[joint_id])] = value
        independent_joints.append(joint_id)
        independent_dofs.append(int(model.jnt_dofadr[joint_id]))

    # All upper-body equality relations are authored as dependent joint1 =
    # polynomial(independent joint2). Apply them explicitly so the requested
    # static pose lies on the equality manifold before evaluating forces.
    for equality_id in range(model.neq):
        if int(model.eq_type[equality_id]) != int(mujoco.mjtEq.mjEQ_JOINT):
            continue
        dependent_joint = int(model.eq_obj1id[equality_id])
        source_joint = int(model.eq_obj2id[equality_id])
        source_qpos = int(model.jnt_qposadr[source_joint])
        dependent_qpos = int(model.jnt_qposadr[dependent_joint])
        value, _ = evaluate_polynomial(model.eq_data[equality_id], float(data.qpos[source_qpos]))
        data.qpos[dependent_qpos] = value

    data.qvel[:] = 0
    data.qacc[:] = 0
    data.ctrl[:] = 0
    if model.na:
        data.act[:] = 0
    mujoco.mj_forward(model, data)

    # R maps independent virtual displacements to the full generalized
    # coordinates. Effective generalized force is therefore R.T @ qfrc.
    reduction = np.zeros((model.nv, len(COORDINATES)), dtype=np.float64)
    for column, dof in enumerate(independent_dofs):
        reduction[dof, column] = 1.0
    joint_to_column = {joint: index for index, joint in enumerate(independent_joints)}
    for equality_id in range(model.neq):
        if int(model.eq_type[equality_id]) != int(mujoco.mjtEq.mjEQ_JOINT):
            continue
        dependent_joint = int(model.eq_obj1id[equality_id])
        source_joint = int(model.eq_obj2id[equality_id])
        column = joint_to_column.get(source_joint)
        if column is None:
            continue
        source_value = float(data.qpos[int(model.jnt_qposadr[source_joint])])
        _, derivative = evaluate_polynomial(model.eq_data[equality_id], source_value)
        reduction[int(model.jnt_dofadr[dependent_joint]), column] += derivative
    return np.asarray(independent_dofs, dtype=np.int32), reduction


def solve_bounded_minimum_norm(
    matrix: np.ndarray,
    target: np.ndarray,
    weights: np.ndarray,
    lower: np.ndarray,
    upper: np.ndarray,
) -> np.ndarray:
    """Active-set solution of min 0.5*x'Wx, Cx=target, lower<=x<=upper."""
    count = matrix.shape[1]
    fixed = np.zeros(count, dtype=bool)
    result = np.zeros(count, dtype=np.float64)

    for _ in range(count * 3):
        free = ~fixed
        adjusted = target - matrix[:, fixed] @ result[fixed]
        free_matrix = matrix[:, free]
        inverse_weights = 1.0 / weights[free]
        gram = (free_matrix * inverse_weights) @ free_matrix.T
        multiplier = np.linalg.lstsq(gram, adjusted, rcond=1e-12)[0]
        result[free] = inverse_weights * (free_matrix.T @ multiplier)

        violations = []
        for index in np.flatnonzero(free):
            if result[index] < lower[index] - 1e-10:
                violations.append((lower[index] - result[index], index, lower[index]))
            elif result[index] > upper[index] + 1e-10:
                violations.append((result[index] - upper[index], index, upper[index]))
        if violations:
            _, index, bound = max(violations)
            result[index] = bound
            fixed[index] = True
            continue

        gradient = weights * result - matrix.T @ multiplier
        releases = []
        for index in np.flatnonzero(fixed):
            if abs(result[index] - lower[index]) < 1e-10 and gradient[index] < -1e-9:
                releases.append((-gradient[index], index))
            elif abs(result[index] - upper[index]) < 1e-10 and gradient[index] > 1e-9:
                releases.append((gradient[index], index))
        if releases:
            _, index = max(releases)
            fixed[index] = False
            continue
        return np.clip(result, lower, upper)
    raise RuntimeError("Bounded minimum-norm active set did not converge")


def analyze_pose(
    model: mujoco.MjModel,
    requested_degrees: dict[str, float],
) -> dict[str, object]:
    data = mujoco.MjData(model)
    body_ids = descendants(model, "clavicle_r")
    actuator_ids = arm_actuators(model, body_ids)
    _, reduction = set_pose(model, data, requested_degrees)

    baseline_full = (
        np.asarray(data.qfrc_actuator, dtype=np.float64)
        + np.asarray(data.qfrc_passive, dtype=np.float64)
        - np.asarray(data.qfrc_bias, dtype=np.float64)
    )
    baseline = reduction.T @ baseline_full
    baseline_actuator_force = np.asarray(data.actuator_force, dtype=np.float64).copy()
    columns = np.zeros((len(COORDINATES), len(actuator_ids)), dtype=np.float64)
    active_force_capacity = np.zeros(len(actuator_ids), dtype=np.float64)

    for column, actuator_id in enumerate(actuator_ids):
        activation_address = int(model.actuator_actadr[actuator_id])
        if activation_address < 0:
            raise RuntimeError(f"Expected muscle activation state: actuator {actuator_id}")
        data.act[activation_address] = 1.0
        mujoco.mj_forward(model, data)
        active_generalized = (
            np.asarray(data.qfrc_actuator, dtype=np.float64)
            - (baseline_full - np.asarray(data.qfrc_passive) + np.asarray(data.qfrc_bias))
        )
        columns[:, column] = reduction.T @ active_generalized
        active_force_capacity[column] = (
            float(data.actuator_force[actuator_id]) - baseline_actuator_force[actuator_id]
        )
        data.act[activation_address] = 0.0

    reserve_columns = np.eye(len(COORDINATES)) * RESERVE_CAPACITY_NM
    solve_matrix = np.concatenate((columns, reserve_columns), axis=1)
    variable_count = solve_matrix.shape[1]
    weights = np.concatenate((
        np.ones(len(actuator_ids)),
        np.full(len(COORDINATES), RESERVE_OBJECTIVE_WEIGHT),
    ))
    lower = np.concatenate((np.zeros(len(actuator_ids)), -np.ones(len(COORDINATES))))
    upper = np.ones(variable_count)
    solution = solve_bounded_minimum_norm(
        solve_matrix, -baseline, weights, lower, upper
    )
    activations = solution[: len(actuator_ids)]
    reserves = solution[len(actuator_ids) :] * RESERVE_CAPACITY_NM
    residual = baseline + columns @ activations + reserves

    ranked = sorted(
        (
            {
                "name": object_name(model, mujoco.mjtObj.mjOBJ_ACTUATOR, actuator_id),
                "activation": round(float(activations[index]), 9),
                "activeForceN": round(float(activations[index] * active_force_capacity[index]), 6),
                "momentNormNm": round(float(np.linalg.norm(columns[:, index])), 9),
            }
            for index, actuator_id in enumerate(actuator_ids)
        ),
        key=lambda row: row["activation"],
        reverse=True,
    )
    return {
        "poseDegrees": {
            name: requested_degrees.get(name, 0.0) for name, _ in COORDINATES
        },
        "rightArmBodies": len(body_ids),
        "contributingMuscles": len(actuator_ids),
        "maxResidualNm": float(np.max(np.abs(residual))),
        "maxReserveNm": float(np.max(np.abs(reserves))),
        "rmsReserveNm": float(np.sqrt(np.mean(reserves * reserves))),
        "musclesAtCapacity": int(np.count_nonzero(activations >= 0.995)),
        "maxActivation": float(np.max(activations)),
        "topActivations": ranked[:12],
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
        "--pose-json",
        default="{}",
        help="JSON object with the seven coordinate names in degrees",
    )
    for name, label in COORDINATES:
        parser.add_argument(
            f"--{name}",
            type=float,
            default=None,
            help=f"{label} in degrees",
        )
    arguments = parser.parse_args()
    model = mujoco.MjModel.from_xml_path(str(arguments.model.resolve()))
    requested = json.loads(arguments.pose_json)
    for name, _ in COORDINATES:
        value = getattr(arguments, name)
        if value is not None:
            requested[name] = value
    result = analyze_pose(model, requested)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
