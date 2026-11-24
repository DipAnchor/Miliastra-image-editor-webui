"""Exact drawing-only flattening. Editor shells and local source data stay untouched.

The leaf schema has no general affine matrix or scaled nine-slice borders. Reject
unrepresentable compositions at export, not at object transform/edit time.
"""
from __future__ import annotations

import math
import re
from typing import TYPE_CHECKING

from .lua_mask import mask_active
from .rotation import rotation_matrix

if TYPE_CHECKING:
    from .main import SceneDocumentModel, SceneElementModel, SmartObjectModel


class FlattenError(ValueError):
    pass


def _fail(path: str, reason: str):
    raise FlattenError(f"Smart object {path}: {reason}. JSON preserves the complete editable scene.")


def _group_state(groups):
    by_id = {group.id: group for group in groups}
    states = {}
    for group in groups:
        chain, seen, current = [], set(), group.id
        while current is not None and current not in states:
            if current in seen or current not in by_id:
                raise FlattenError(f"Invalid drawing group parent or cycle: {current}")
            seen.add(current)
            chain.append(by_id[current])
            current = by_id[current].parentId
        visible, opacity = states.get(current, (True, 1.0))
        for node in reversed(chain):
            if not math.isfinite(node.opacity):
                raise FlattenError(f"Invalid drawing group opacity: {node.id}")
            visible = visible and node.visible
            opacity *= max(0.0, min(1.0, node.opacity))
            states[node.id] = visible, opacity
    return states


def _state(element, states):
    # Old flat JSON may contain an orphan groupId; retain its historic root behavior.
    visible, opacity = states.get(element.groupId, (True, 1.0))
    return visible and element.visible, opacity


def _opacity(leaf, opacity):
    updates = {"opacity": leaf.opacity * opacity}
    if leaf.textBox is not None:
        box = leaf.textBox
        updates["textBox"] = box.model_copy(update={
            f"{prefix}Opacity": getattr(box, f"{prefix}Opacity") * opacity
            for prefix in ("text", "bg", "outline")
        })
        updates["opacity"] = updates["textBox"].textOpacity
    return leaf.model_copy(update=updates)


def _compose_rotation(leaf, obj, path):
    # Only retain the existing Euler tuple if it reproduces the left-multiplied
    # projection. Merely adding Z is wrong for general Ry * Rx * Rz content.
    a, b, c, d = rotation_matrix(obj.rotation)
    la, lb, lc, ld = rotation_matrix(leaf.rotation, leaf.rotationX, leaf.rotationY)
    expected = (a * la + c * lb, b * la + d * lb,
                a * lc + c * ld, b * lc + d * ld)
    z = (leaf.rotation + obj.rotation + 180) % 360 - 180
    candidate = rotation_matrix(z, leaf.rotationX, leaf.rotationY)
    if any(abs(x - y) > 1e-9 for x, y in zip(expected, candidate)):
        _fail(path, "mixed-axis rotation composition has no verified exact leaf representation")
    return z


def _scale_text(box, scale, path):
    updates = {}
    for key in ("fontSize", "minFontSize"):
        value = getattr(box, key) * scale
        if not math.isfinite(value) or value < 1 or abs(value - round(value)) > 1e-9:
            _fail(path, f"scaled {key} font size is not a positive integer")
        updates[key] = int(round(value))

    def resize(match):
        value = float(match.group(1)) * scale
        if not math.isfinite(value) or value < 1 or abs(value - round(value)) > 1e-9:
            _fail(path, "scaled rich-text font size is not a positive integer")
        return f"<size={int(round(value))}>"

    updates["text"] = re.sub(r"<size\s*=\s*([0-9]+(?:\.[0-9]+)?)\s*>", resize, box.text, flags=re.I)
    return box.model_copy(update=updates)


def _bake(leaf: SceneElementModel, obj: SmartObjectModel):
    path = f"{obj.id}/{leaf.id}"
    scale = obj.scale
    z = _compose_rotation(leaf, obj, path)
    if scale != 1 and leaf.type == "image" and leaf.imageType == "stretch":
        _fail(path, "stretch / nine-slice image borders cannot be scaled by the leaf schema")
    if mask_active(leaf.luaMask):
        if scale != 1 and leaf.luaMask.imageType != "basic":
            _fail(path, "mask scaling requires an explicit basic imageType; stretch/native borders are not scalable")
    w, h = leaf.width * scale, leaf.height * scale
    if not all(math.isfinite(value) and value >= 1 for value in (w, h)):
        _fail(path, "scaled dimensions would be clamped below one pixel or overflow")
    a, b, c, d = rotation_matrix(obj.rotation)
    x, y = leaf.x - obj.content.frame.width / 2, leaf.y - obj.content.frame.height / 2
    updates = dict(x=obj.x + scale * (a * x + c * y), y=obj.y + scale * (b * x + d * y),
                   width=w, height=h, rotation=z)
    if not all(math.isfinite(updates[key]) for key in ("x", "y")):
        _fail(path, "world position overflows finite geometry")
    box = leaf.textBox
    if box is not None:
        # Native anchors/pivots refer to the drawing ROOT. A local frame has a
        # different parent and cannot be removed by changing just its center.
        if any(getattr(box, key) != 0.5 for key in (
            "anchorMinX", "anchorMinY", "anchorMaxX", "anchorMaxY", "pivotX", "pivotY"
        )):
            _fail(path, "custom text anchors/pivot cannot be rebased exactly from the fixed local frame")
        if scale != 1:
            updates["textBox"] = _scale_text(box, scale, path)
    if leaf.luaMask is not None and (scale != 1 or obj.rotation % 360 != 0):
        mask = leaf.luaMask
        values = dict(offsetX=scale * (a * mask.offsetX + c * mask.offsetY),
                      offsetY=scale * (b * mask.offsetX + d * mask.offsetY),
                      rotation=(mask.rotation + obj.rotation + 180) % 360 - 180)
        values.update({key: None if getattr(mask, key) is None else getattr(mask, key) * scale
                       for key in ("width", "height")})
        if mask.softEdgeMode == "Pixel":
            values.update({key: getattr(mask, key) * scale for key in ("softEdgeWidthX", "softEdgeWidthY")})
        if any(value is not None and not math.isfinite(value) for value in values.values()):
            _fail(path, "scaled mask geometry overflows")
        updates["luaMask"] = mask.model_copy(update=values)
    return leaf.model_copy(update=updates)


def flatten(scene: SceneDocumentModel, *, backgrounds_first: bool = False, resolve_mask=None) -> SceneDocumentModel:
    """Return visible leaves with contiguous scope order and baked group alpha.

    No clipping to the fixed frame, no source mutation, no hidden-leaf capability
    checks. Generic drawing keeps zIndex; GIA-family callers opt into background
    priority within each scope, before internal background markers are removed.
    The caller resolves default image types before flattening objects.
    """
    root_states = _group_state(scene.groups)
    result = []
    used = {element.id for element in scene.elements}
    order_key = (lambda item: (not getattr(item, "isBackground", False), item.zIndex)) if backgrounds_first else (lambda item: item.zIndex)
    for layer in sorted(scene.elements, key=order_key):
        visible, opacity = _state(layer, root_states)
        if not visible:
            continue
        if layer.type != "smart-object":
            result.append(_opacity(layer, opacity))
            continue
        local_states = _group_state(layer.content.groups)
        for leaf in sorted(layer.content.elements, key=order_key):
            visible, local_opacity = _state(leaf, local_states)
            if not visible:
                continue
            if resolve_mask is not None and layer.scale != 1 and mask_active(leaf.luaMask) and leaf.luaMask.imageType is None:
                leaf = resolve_mask(leaf)
            transformed = _opacity(_bake(leaf, layer), opacity * layer.opacity * local_opacity)
            stem = f"{layer.id}/{leaf.id}"
            candidate, suffix = stem, 1
            while candidate in used:
                candidate, suffix = f"{stem}#{suffix}", suffix + 1
            used.add(candidate)
            # Internal background is local to the shell; never hoist it below
            # unrelated outer layers when downstream GIA/Lua sorts backgrounds.
            result.append(transformed.model_copy(update={"id": candidate, "isBackground": False}))
    return scene.model_copy(update={"elements": [leaf.model_copy(update={
        "zIndex": index, "visible": True, "groupId": None
    }) for index, leaf in enumerate(result)], "groups": []})
