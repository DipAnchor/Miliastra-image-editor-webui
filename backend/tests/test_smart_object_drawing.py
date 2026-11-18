import base64
import copy
import io
import json
import math
import re
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from PIL import Image
from app import lua_scene, main
from app.rotation import rotation_matrix


def drawable_object(**overrides):
    obj = dict(type="smart-object", id="object", x=50, y=45, rotation=40, scale=2,
               opacity=0.8, zIndex=1, content=dict(frame=dict(width=20, height=10), groups=[],
               elements=[dict(id="leaf", type="rectangle", x=15, y=3, width=8, height=4,
                              rotation=-25, color="#ff0000", opacity=0.5)]))
    obj.update(overrides)
    return dict(canvas=dict(width=100, height=100), schemaVersion=2, elements=[obj])


def flatten(payload):
    return main.normalize_drawing_scene(main.SceneDocumentModel.model_validate(payload))


class SmartObjectDrawingTests(unittest.TestCase):
    def test_world_corners_fixed_frame_overflow_and_source_unchanged(self):
        for z in (-135, -40, 40, 90, 179):
            for scale in (0.25, 1, 3):
                with self.subTest(z=z, scale=scale):
                    payload = drawable_object(rotation=z, scale=scale)
                    leaf = payload["elements"][0]["content"]["elements"][0]
                    leaf.update(x=-12, y=24)
                    original = copy.deepcopy(payload)
                    result = flatten(payload)
                    self.assertEqual(len(result.elements), 1)
                    got = result.elements[0]
                    a, b, c, d = rotation_matrix(z)
                    la, lb, lc, ld = rotation_matrix(leaf["rotation"])
                    ga, gb, gc, gd = main.element_rotation_matrix(got)
                    for dx, dy in ((-4, -2), (4, -2), (4, 2), (-4, 2)):
                        lx = leaf["x"] + la * dx + lc * dy - 10
                        ly = leaf["y"] + lb * dx + ld * dy - 5
                        wx = 50 + scale * (a * lx + c * ly)
                        wy = 45 + scale * (b * lx + d * ly)
                        self.assertAlmostEqual(got.x + scale * (ga * dx + gc * dy), wx)
                        self.assertAlmostEqual(got.y + scale * (gb * dx + gd * dy), wy)
                    self.assertEqual(payload, original)

    def test_scope_visibility_opacity_order_and_ids(self):
        payload = drawable_object(rotation=0, scale=1, groupId="outer")
        payload["groups"] = [dict(id="outer", opacity=0.5)]
        obj = payload["elements"][0]
        obj["content"]["groups"] = [dict(id="g", opacity=0.25), dict(id="hidden", visible=False)]
        leaf = obj["content"]["elements"][0]
        leaf.update(groupId="g", zIndex=2)
        obj["content"]["elements"] += [dict(leaf, id="lower", zIndex=0, groupId=None),
            dict(leaf, id="hidden-leaf", groupId="hidden", rotationX=30), dict(leaf, id="off", visible=False)]
        payload["elements"] += [dict(id="below", type="ellipse", x=1, y=1, width=2, height=2, zIndex=0),
                                  dict(id="above", type="ellipse", x=1, y=1, width=2, height=2, zIndex=2)]
        result = flatten(payload)
        self.assertEqual([e.type for e in result.elements], ["ellipse", "rectangle", "rectangle", "ellipse"])
        self.assertEqual([e.zIndex for e in result.elements], list(range(4)))
        self.assertAlmostEqual(result.elements[1].opacity, 0.5 * 0.8 * 0.5)
        self.assertAlmostEqual(result.elements[2].opacity, 0.5 * 0.8 * 0.5 * 0.25)
        self.assertEqual(result.groups, [])
        self.assertTrue(all(e.visible and e.groupId is None for e in result.elements))
        self.assertEqual(len({e.id for e in result.elements}), 4)
        payload["groups"][0]["visible"] = False
        self.assertEqual(len(flatten(payload).elements), 2)

    def test_all_routes_and_direct_renderers_use_same_flat_scene(self):
        payload = drawable_object()
        source = main.SceneDocumentModel.model_validate(payload)
        flat = flatten(payload)
        for encode in (main.scene_to_css, main.scene_to_svg, main.scene_to_png_bytes,
                       main.scene_to_gia_document):
            with self.subTest(encoder=encode.__name__):
                self.assertEqual(encode(source), encode(flat))
        for route in (main.export_css, main.export_svg, main.export_png, main.export_gia,
                      main.export_container_node):
            with self.subTest(route=route.__name__):
                self.assertEqual(route(main.ExportRequest(scene=source)).body,
                                 route(main.ExportRequest(scene=flat)).body)
        image = Image.open(io.BytesIO(main.export_png(main.ExportRequest(scene=source)).body))
        self.assertIsNotNone(image.getchannel("A").getbbox())

    def test_mixed_axis_is_not_prebanned_but_inexact_composition_is_diagnosed(self):
        payload = drawable_object(rotation=0)
        leaf = payload["elements"][0]["content"]["elements"][0]
        leaf.update(rotationX=30, rotationY=20)
        got = flatten(payload).elements[0]
        self.assertEqual((got.rotationX, got.rotationY), (30, 20))
        payload["elements"][0]["rotation"] = 40
        with self.assertRaises(HTTPException) as caught:
            flatten(payload)
        self.assertIn("object/leaf", caught.exception.detail)
        self.assertIn("mixed-axis", caught.exception.detail)
        # Degenerate/commuting projections are still permitted if corners agree.
        leaf.update(rotationX=180, rotationY=180)
        self.assertEqual(len(flatten(payload).elements), 1)

    def test_stretch_scale_resolved_before_capability_check(self):
        payload = drawable_object()
        leaf = payload["elements"][0]["content"]["elements"][0]
        leaf.update(type="image", imageAssetId=106001)
        with patch.object(main, "load_image_metas", return_value={106001: {"border": {"left": 2}}}):
            with self.assertRaises(HTTPException) as caught:
                flatten(payload)
        self.assertIn("object/leaf", caught.exception.detail)
        self.assertIn("stretch", caught.exception.detail)
        leaf["imageType"] = "basic"
        self.assertEqual(flatten(payload).elements[0].width, 16)

    def test_mask_dimensions_pixel_feather_and_percentage_units(self):
        payload = drawable_object(rotation=0)
        leaf = payload["elements"][0]["content"]["elements"][0]
        leaf["luaMask"] = dict(enabled=True, imageType="basic", offsetX=3, offsetY=-2,
                               width=7, height=None, enableSoftEdge=True, softEdgeWidthX=4,
                               softEdgeWidthY=5, horizontalSoftRange=81)
        mask = flatten(payload).elements[0].luaMask
        self.assertEqual((mask.offsetX, mask.offsetY, mask.width, mask.height), (6, -4, 14, None))
        self.assertEqual((mask.softEdgeWidthX, mask.softEdgeWidthY, mask.horizontalSoftRange), (8, 10, 81))
        leaf["luaMask"]["softEdgeMode"] = "Percentage"
        self.assertEqual(flatten(payload).elements[0].luaMask.softEdgeWidthX, 4)
        payload["elements"][0]["rotation"] = 40
        with self.assertRaises(HTTPException) as caught:
            flatten(payload)
        self.assertIn("mask", caught.exception.detail)
        payload["elements"][0]["rotation"] = 0
        leaf["luaMask"]["imageType"] = "stretch"
        with self.assertRaises(HTTPException):
            flatten(payload)

    def test_text_scale_all_opacities_rich_sizes_and_integer_diagnostics(self):
        payload = drawable_object(rotation=0)
        leaf = payload["elements"][0]["content"]["elements"][0]
        leaf.update(type="textbox", textBox=dict(text="<size=15>Hi</size>", fontSize=20, minFontSize=12,
                    textOpacity=0.5, bgOpacity=0.25, outlineOpacity=0.75))
        got = flatten(payload).elements[0]
        self.assertEqual((got.textBox.fontSize, got.textBox.minFontSize), (40, 24))
        self.assertEqual(got.textBox.text, "<size=30>Hi</size>")
        self.assertAlmostEqual(got.textBox.textOpacity, 0.4)
        self.assertAlmostEqual(got.textBox.bgOpacity, 0.2)
        self.assertAlmostEqual(got.textBox.outlineOpacity, 0.6)
        payload["elements"][0]["scale"] = 0.3
        with self.assertRaises(HTTPException) as caught:
            flatten(payload)
        self.assertIn("font", caught.exception.detail)

    def test_direct_renderers_use_supplied_image_metadata_before_flattening(self):
        payload = drawable_object()
        payload["elements"][0]["content"]["elements"][0].update(type="image", imageAssetId=106001)
        source = main.SceneDocumentModel.model_validate(payload)
        for render in (main.scene_to_css, main.scene_to_svg, main.scene_to_png_bytes):
            with self.subTest(render=render.__name__), patch.object(main, "load_image_metas") as load:
                with self.assertRaises(HTTPException) as caught:
                    render(source, {106001: {"border": {"left": 2}}})
                self.assertIn("stretch", caught.exception.detail)
                load.assert_not_called()

    def test_backgrounds_stay_in_scope_and_generated_ids_never_collide(self):
        payload = drawable_object(rotation=0, scale=1)
        obj = payload["elements"][0]
        obj["content"]["elements"][0]["isBackground"] = True
        obj["content"]["elements"].append(dict(obj["content"]["elements"][0], id="front", isBackground=False))
        payload["elements"] += [dict(id="object/leaf", type="ellipse", x=1, y=1, width=2, height=2, zIndex=0),
                                  dict(id="bg", type="ellipse", x=1, y=1, width=2, height=2, zIndex=9, isBackground=True)]
        flat = flatten(payload)
        self.assertEqual([e.id for e in flat.elements], ["object/leaf", "object/leaf#1", "object/front", "bg"])
        self.assertEqual([e.isBackground for e in flat.elements], [False, False, False, True])
        gia_flat = main.normalize_drawing_scene(main.SceneDocumentModel.model_validate(payload), backgrounds_first=True)
        self.assertEqual([e.id for e in gia_flat.elements], ["bg", "object/leaf", "object/leaf#1", "object/front"])
        self.assertEqual([e.isBackground for e in gia_flat.elements], [True, False, False, False])

    def test_background_priority_is_format_specific_at_root_and_object_scopes(self):
        payload = drawable_object(rotation=0, scale=1, x=50, y=50, opacity=1)
        obj = payload["elements"][0]
        obj["content"]["elements"] = [
            dict(id="front", type="rectangle", x=10, y=5, width=20, height=20, color="#ff0000", zIndex=0),
            dict(id="local-bg", type="rectangle", x=10, y=5, width=20, height=20, color="#0000ff", zIndex=9, isBackground=True)]
        payload["elements"] += [
            dict(id="below", type="rectangle", x=50, y=50, width=20, height=20, color="#00ff00", zIndex=0),
            dict(id="root-bg", type="rectangle", x=50, y=50, width=20, height=20, color="#ffff00", zIndex=9, isBackground=True)]
        source = main.SceneDocumentModel.model_validate(payload)
        generic = main.normalize_drawing_scene(source)
        gia_flat = main.normalize_drawing_scene(source, backgrounds_first=True)
        self.assertEqual([e.color for e in generic.elements], ["#00ff00", "#ff0000", "#0000ff", "#ffff00"])
        expected_gia = ["#ffff00", "#00ff00", "#0000ff", "#ff0000"]
        self.assertEqual([e.color for e in gia_flat.elements], expected_gia)
        self.assertEqual([e.isBackground for e in gia_flat.elements], [True, False, False, False])
        for render in (main.scene_to_css, main.scene_to_svg, main.scene_to_png_bytes):
            with self.subTest(render=render.__name__):
                self.assertEqual(render(source), render(generic))
        for route in (main.export_css, main.export_svg, main.export_png):
            with self.subTest(route=route.__name__):
                self.assertEqual(route(main.ExportRequest(scene=source)).body, route(main.ExportRequest(scene=generic)).body)
        pixel = Image.open(io.BytesIO(main.scene_to_png_bytes(source))).getpixel((50, 50))
        self.assertEqual(pixel, (255, 255, 0, 255))
        self.assertEqual(main.scene_to_gia_document(source), main.scene_to_gia_document(gia_flat))
        for route in (main.export_gia, main.export_container_node):
            with self.subTest(route=route.__name__):
                self.assertEqual(route(main.ExportRequest(scene=source)).body, route(main.ExportRequest(scene=gia_flat)).body)
        for control_runtime in (False, True):
            with self.subTest(control_runtime=control_runtime):
                if control_runtime:
                    obj["content"]["elements"].append(dict(id="text", type="textbox", x=10, y=5, width=20, height=20,
                        zIndex=10, textBox=dict(text="force control runtime")))
                    source = main.SceneDocumentModel.model_validate(payload)
                script = main.export_lua(main.ExportRequest(scene=source)).body.decode()
                actual = main.parse_lua_scene(script.split(lua_scene.METADATA_PREFIX)[0])
                self.assertEqual([e.color for e in actual.elements if e.type != "textbox"], expected_gia)
                self.assertEqual(main.parse_lua_scene(script).elements, main.normalize_scene(source).elements)

    def test_plain_leaf_background_marker_does_not_change_css_svg_png_order(self):
        source = main.SceneDocumentModel.model_validate(dict(canvas=dict(width=30, height=30), elements=[
            dict(id="front", type="rectangle", x=15, y=15, width=20, height=20, color="#ff0000", zIndex=0),
            dict(id="background", type="rectangle", x=15, y=15, width=20, height=20, color="#0000ff", zIndex=9, isBackground=True)]))
        without_marker = source.model_copy(update={"elements": [e.model_copy(update={"isBackground": False}) for e in source.elements]})
        for render in (main.scene_to_css, main.scene_to_svg, main.scene_to_png_bytes):
            with self.subTest(render=render.__name__):
                self.assertEqual(render(source), render(without_marker))
        for route in (main.export_css, main.export_svg, main.export_png):
            with self.subTest(route=route.__name__):
                self.assertEqual(route(main.ExportRequest(scene=source)).body, route(main.ExportRequest(scene=without_marker)).body)
        self.assertEqual(Image.open(io.BytesIO(main.scene_to_png_bytes(source))).getpixel((15, 15)), (0, 0, 255, 255))
        for route in (main.export_gia, main.export_container_node):
            with self.subTest(route=route.__name__):
                self.assertNotEqual(route(main.ExportRequest(scene=source)).body, route(main.ExportRequest(scene=without_marker)).body)
        script = main.export_lua(main.ExportRequest(scene=source)).body.decode()
        actual = main.parse_lua_scene(script.split(lua_scene.METADATA_PREFIX)[0])
        self.assertEqual([e.color for e in actual.elements], ["#0000ff", "#ff0000"])

    def test_all_drawing_routes_report_inexact_geometry_with_leaf_path(self):
        for reason in ("mixed-axis", "stretch", "mask", "font", "anchors", "dimensions", "overflows"):
            payload = drawable_object()
            obj = payload["elements"][0]
            leaf = obj["content"]["elements"][0]
            if reason == "mixed-axis":
                leaf["rotationX"] = 30
            elif reason == "stretch":
                leaf.update(type="image", imageAssetId=106001, imageType="stretch")
            elif reason == "mask":
                leaf["luaMask"] = dict(enabled=True, imageType="basic")
            elif reason in ("font", "anchors"):
                leaf.update(type="textbox", textBox=dict(fontSize=15, minFontSize=10))
                if reason == "font":
                    obj["scale"] = 1.1
                else:
                    leaf["textBox"]["pivotX"] = 0
            elif reason == "dimensions":
                obj["scale"] = 0.1
            else:
                obj.update(x=1e308, scale=2)
                leaf["x"] = 1e308
            source = main.SceneDocumentModel.model_validate(payload)
            for route in (main.export_css, main.export_svg, main.export_png, main.export_gia,
                          main.export_container_node, main.export_lua):
                with self.subTest(reason=reason, route=route.__name__), patch.object(
                        main, "load_image_metas", return_value={106001: {"border": {"left": 2}}}):
                    with self.assertRaises(HTTPException) as caught:
                        route(main.ExportRequest(scene=source))
                    self.assertEqual(caught.exception.status_code, 400)
                    self.assertIn("object/leaf", caught.exception.detail)
                    self.assertIn(reason, caught.exception.detail)
            self.assertIn("smart-object", main.export_json(main.ExportRequest(scene=source)).body.decode())

    def test_hidden_inexact_leaves_do_not_block_visible_drawing(self):
        payload = drawable_object()
        obj = payload["elements"][0]
        obj["content"]["elements"][0].update(visible=False, rotationX=40)
        self.assertEqual(flatten(payload).elements, [])

    def test_lua_snapshot_is_full_but_digest_is_actual_flat_drawing(self):
        payload = drawable_object()
        obj = payload["elements"][0]
        obj["content"]["elements"].append(dict(id="hidden", type="rectangle", x=0, y=0,
            width=4, height=2, visible=False, rotationX=70))
        payload["library"] = dict(savedItems=[dict(id="saved", name="object", element=copy.deepcopy(obj))])
        source = main.normalize_scene(main.SceneDocumentModel.model_validate(payload))
        script = main.export_lua(main.ExportRequest(scene=source)).body.decode()
        drawing = lua_scene.read_drawing(script)
        self.assertEqual(len(drawing["rows"]), 1)
        metadata = json.loads(base64.b64decode(script.split(lua_scene.METADATA_PREFIX)[1].strip()))
        self.assertEqual(metadata["scene"], source.model_dump())
        self.assertEqual(metadata["drawingHash"], lua_scene._digest(drawing))
        restored = main.parse_lua_scene(script)
        self.assertEqual(restored.elements, source.elements)
        self.assertEqual(restored.library, source.library)
        row = drawing["rows"][0]
        replacement = list(row)
        replacement[1] += 9
        changed = script.replace("{" + ",".join(map(repr, row)) + "}",
                                 "{" + ",".join(map(repr, replacement)) + "}", 1)
        self.assertNotEqual(changed, script)
        restored = main.parse_lua_scene(changed)
        self.assertEqual(restored.elements[0].type, "rectangle")
        self.assertEqual(restored.library, source.library)
        self.assertTrue(any("edited" in warning for warning in restored.meta.warnings))
        self.assertFalse(any(e.type == "smart-object" for e in restored.elements))
