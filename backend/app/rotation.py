"""Orthographic UI-plane projection; single axes verified by ROTXY2 on PC.

Mixed axes use Z-X-Y Euler order (Ry * Rx * Rz) as an explicit editor policy.
Coordinates returned here are screen-space (Y down); stored Z is CCW positive.
"""
import math


def rotation_matrix(z=0.0, x=0.0, y=0.0):
    rx, ry, rz = map(math.radians, (x, y, z))
    cx, sx, cy, sy, cz, sz = math.cos(rx), math.sin(rx), math.cos(ry), math.sin(ry), math.cos(rz), math.sin(rz)
    values = (cy * cz + sy * sx * sz, -cx * sz, cy * sz - sy * sx * cz, cx * cz)
    return tuple(0.0 if abs(value) < 1e-12 else value for value in values)


def masked_content_rotation(z=0.0, x=0.0, y=0.0, mask_z=0.0) -> tuple[float, float, float]:
    """Return child (X, Y, Z) under a pure-Z mask in the editor convention.

    Rz(mask_z) * Ry(child_y) * Rx(child_x) * Rz(child_z) equals
    Ry(y) * Rx(x) * Rz(z). This is a mathematical convention, not evidence
    that the native UI API uses this mixed-axis Euler order.
    """
    if not all(math.isfinite(value) for value in (z, x, y, mask_z)):
        raise ValueError("Rotation angles must be finite")
    mask_z %= 360
    if mask_z == 0:
        return x, y, z
    if x % 360 == 0 and y % 360 == 0:
        return x, y, z - mask_z

    rx, ry, rz, rm = map(math.radians, (x % 360, y % 360, z % 360, mask_z))
    cx, sx = math.cos(rx), math.sin(rx)
    cy, sy = math.cos(ry), math.sin(ry)
    cz, sz = math.cos(rz), math.sin(rz)
    cm, sm = math.cos(rm), math.sin(rm)
    # Q = Rz(-mask_z) * Ry(y) * Rx(x) * Rz(z), in UI Y-up.
    r11, r12, r13 = cy * cz + sy * sx * sz, -cy * sz + sy * sx * cz, sy * cx
    r21, r22, r23 = cx * sz, cx * cz, -sx
    q11, q12, q13 = cm * r11 + sm * r21, cm * r12 + sm * r22, cm * r13 + sm * r23
    q21, q22, q23 = -sm * r11 + cm * r21, -sm * r12 + cm * r22, -sm * r13 + cm * r23
    q31, q33 = -sy * cz + cy * sx * sz, cy * cx
    cosine_x = math.hypot(q21, q22)
    child_x = math.atan2(-q23, cosine_x)
    if cosine_x <= 1e-12:
        # At X = +/-90 only Y - sign(X)*Z remains observable. Choose Z=0.
        child_z = 0.0
        child_y = math.atan2(-q31, q11)
    else:
        child_z = math.atan2(q21, q22)
        sine_x, ccz, ssz = math.sin(child_x), math.cos(child_z), math.sin(child_z)
        # Near a pole q13 and q33 both vanish. Recover Y from the first row.
        child_y = (math.atan2((q11 * ssz + q12 * ccz) / sine_x, q11 * ccz - q12 * ssz)
                   if abs(sine_x) > 0.5 else math.atan2(q13, q33))
    return tuple(math.degrees(value) for value in (child_x, child_y, child_z))
