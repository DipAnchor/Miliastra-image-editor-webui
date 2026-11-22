import base64
import copy
import json
import unittest

from app import lua_scene
from app.main import (
    ExportRequest, SceneDocumentModel, export_json, export_lua,
    flatten_drawing_scene, normalize_scene, parse_json_scene, parse_lua_scene,
)


def scene_dict():
    return {
        "canvas": {"width": 100, "height": 100, "background": "transparent"},
        "elements": [
            {"id": "a", "name": "矩形", "type": "rectangle", "x": 50, "y": 50,
             "width": 20, "height": 20, "color": "#ff0000", "opacity": 1, "zIndex": 0,
             "visible": False, "layerName": "背景层", "groupId": "g1"},
            {"id": "b", "name": "圆", "type": "ellipse", "x": 20, "y": 20,
             "width": 10, "height": 10, "color": "#00ff00", "opacity": 1, "zIndex": 1,
             "visible": True, "layerName": "", "groupId": None},
        ],
        "meta": {"sourceType": "editor", "sourceName": "", "warnings": []},
        "groups": [
            {"id": "g1", "name": "组一", "parentId": None, "visible": False,
             "opacity": 0.5, "collapsed": True, "order": 0}
        ],
    }


def neutral_group_scenes():
    before = {
        "schemaVersion": 1,
        "canvas": {"width": 120, "height": 100, "background": "transparent"},
        "groups": [
            {"id": "half", "name": "半透明原组", "opacity": 0.5, "order": 7},
            {"id": "hidden", "name": "隐藏原组", "visible": False, "order": 13},
            {"id": "locked", "name": "保留的锁定组", "locked": True, "collapsed": True, "order": 21},
        ],
        "elements": [
            {"id": "root", "type": "ellipse", "x": 18, "y": 22, "width": 12, "height": 16,
             "rotation": -15, "opacity": 0.6, "zIndex": 4, "locked": True},
            {"id": "body", "type": "rectangle", "x": 50, "y": 40, "width": 30, "height": 20,
             "rotation": 15, "color": "#ff0000", "opacity": 0.8, "zIndex": 9, "groupId": "half",
             "luaMask": {"enabled": True, "imageType": "basic", "offsetX": 3, "offsetY": -2,
                         "width": 24, "height": 16, "rotation": -27, "reverseMaskArea": True,
                         "enableSoftEdge": True, "softEdgeMode": "Pixel",
                         "softEdgeWidthX": 2, "softEdgeWidthY": 3}},
            {"id": "background", "type": "rectangle", "x": 60, "y": 50, "width": 100, "height": 80,
             "opacity": 0.4, "zIndex": 25, "isBackground": True, "groupId": "half"},
            {"id": "ancestor-hidden", "type": "rectangle", "x": 75, "y": 35, "width": 8, "height": 6,
             "opacity": 0.9, "zIndex": 40, "groupId": "hidden"},
            {"id": "self-hidden", "type": "ellipse", "x": 85, "y": 65, "width": 10, "height": 10,
             "visible": False, "zIndex": 55},
            {"id": "locked-member", "type": "ellipse", "x": 90, "y": 80, "width": 6, "height": 8,
             "opacity": 0.7, "zIndex": 80, "groupId": "locked"},
        ],
    }
    after = copy.deepcopy(before)
    after["groups"] += [
        {"id": "parts", "name": "身体部件", "parentId": "half", "visible": True,
         "opacity": 1, "collapsed": False, "order": 0},
        {"id": "nested", "name": "背景子组", "parentId": "parts", "visible": True,
         "opacity": 1, "collapsed": False, "order": 0},
        {"id": "hidden-parts", "name": "隐藏部件", "parentId": "hidden", "visible": True,
         "opacity": 1, "collapsed": False, "order": 0},
    ]
    for element in after["elements"]:
        element["groupId"] = {"body": "parts", "background": "nested",
                              "ancestor-hidden": "hidden-parts"}.get(element["id"], element.get("groupId"))
    return before, after


class LayerFieldPersistenceTests(unittest.TestCase):
    def test_model_roundtrip_preserves_layer_fields(self):
        dumped = SceneDocumentModel.model_validate(scene_dict()).model_dump()
        el = dumped["elements"][0]
        self.assertEqual(el["visible"], False)
        self.assertEqual(el["layerName"], "背景层")
        self.assertEqual(el["groupId"], "g1")
        self.assertEqual(dumped["groups"][0]["opacity"], 0.5)
        self.assertEqual(dumped["groups"][0]["collapsed"], True)

    def test_normalize_scene_preserves_layer_fields(self):
        scene = normalize_scene(SceneDocumentModel.model_validate(scene_dict()))
        el = scene.elements[0]
        self.assertEqual(el.visible, False)
        self.assertEqual(el.layerName, "背景层")
        self.assertEqual(el.groupId, "g1")
        self.assertEqual(scene.groups[0].id, "g1")
        self.assertEqual(scene.groups[0].visible, False)

    def test_export_json_preserves_layer_fields(self):
        resp = export_json(ExportRequest(scene=SceneDocumentModel.model_validate(scene_dict())))
        data = json.loads(resp.body.decode("utf-8"))
        self.assertEqual(data["elements"][0]["layerName"], "背景层")
        self.assertEqual(data["groups"][0]["name"], "组一")

    def test_json_export_import_preserves_nested_groups(self):
        payload = scene_dict()
        payload["groups"].append({
            "id": "g2", "name": "子组", "parentId": "g1", "visible": True,
            "opacity": 0.75, "collapsed": False, "order": 1,
        })
        payload["elements"][0]["groupId"] = "g2"
        response = export_json(ExportRequest(scene=SceneDocumentModel.model_validate(payload)))
        exported = json.loads(response.body)
        for content in (exported, {"scene": exported}):
            with self.subTest(wrapped="scene" in content):
                restored = parse_json_scene(json.dumps(content)).model_dump()
                self.assertEqual(restored["groups"], exported["groups"])
                self.assertEqual(restored["elements"], exported["elements"])

    def test_json_roundtrip_preserves_locks_version_and_library(self):
        payload = scene_dict()
        payload["schemaVersion"] = 1
        payload["elements"][0]["locked"] = True
        payload["groups"][0]["locked"] = True
        payload["library"] = {"savedItems": [{
            "id": "saved-a", "name": "Locked shape", "category": "基础形状",
            "element": dict(payload["elements"][0]),
        }]}
        response = export_json(ExportRequest(scene=SceneDocumentModel.model_validate(payload)))
        restored = parse_json_scene(response.body.decode("utf-8")).model_dump()
        self.assertEqual(restored.get("schemaVersion"), 1)
        self.assertIs(restored["elements"][0].get("locked"), True)
        self.assertIs(restored["groups"][0].get("locked"), True)
        self.assertIs(restored["library"]["savedItems"][0]["element"].get("locked"), True)

    def test_neutral_nested_groups_preserve_both_flat_drawing_orders(self):
        before_payload, after_payload = neutral_group_scenes()
        before = SceneDocumentModel.model_validate(before_payload)
        after = SceneDocumentModel.model_validate(after_payload)
        originals = copy.deepcopy((before_payload, after_payload))
        source_models = (before.model_dump(), after.model_dump())
        for backgrounds_first, expected_ids in (
            (False, ["root", "body", "background", "locked-member"]),
            (True, ["background", "root", "body", "locked-member"]),
        ):
            with self.subTest(backgrounds_first=backgrounds_first):
                flat_before = flatten_drawing_scene(before, backgrounds_first=backgrounds_first)
                flat_after = flatten_drawing_scene(after, backgrounds_first=backgrounds_first)
                self.assertEqual(flat_before.elements, flat_after.elements)
                self.assertEqual([element.id for element in flat_after.elements], expected_ids)
                self.assertEqual({element.id for element in flat_after.elements},
                                 {"root", "body", "background", "locked-member"})
                self.assertEqual([element.zIndex for element in flat_after.elements], list(range(4)))
                self.assertEqual(flat_after.groups, [])
                original_by_id = {element.id: element for element in after.elements}
                for element in flat_after.elements:
                    original = original_by_id[element.id]
                    for field in ("x", "y", "width", "height", "rotation", "rotationX", "rotationY", "luaMask", "locked"):
                        self.assertEqual(getattr(element, field), getattr(original, field), (element.id, field))
                    self.assertAlmostEqual(element.opacity, {
                        "root": 0.6, "body": 0.4, "background": 0.2, "locked-member": 0.7,
                    }[element.id])
                    self.assertTrue(element.visible)
                    self.assertIsNone(element.groupId)
        self.assertEqual((before_payload, after_payload), originals)
        self.assertEqual((before.model_dump(), after.model_dump()), source_models)

    def test_neutral_nested_groups_json_roundtrip_preserves_structure_locks_and_mask(self):
        before_payload, after_payload = neutral_group_scenes()
        for version in (None, 1, 2):
            for payload in (before_payload, after_payload):
                source = SceneDocumentModel.model_validate({**payload, "schemaVersion": version})
                exported = json.loads(export_json(ExportRequest(scene=source)).body)
                expected = normalize_scene(source).model_dump()
                self.assertEqual(exported, expected)
                for content in (exported, {"scene": exported}):
                    with self.subTest(version=version, grouped=payload is after_payload, wrapped="scene" in content):
                        restored = parse_json_scene(json.dumps(content)).model_dump()
                        self.assertEqual(restored["schemaVersion"], version)
                        self.assertEqual(restored["groups"], expected["groups"])
                        self.assertEqual(restored["elements"], expected["elements"])
                        self.assertEqual(
                            [(group["id"], group["name"], group["parentId"]) for group in restored["groups"]],
                            [(group["id"], group["name"], group["parentId"]) for group in expected["groups"]],
                        )
                        elements = {element["id"]: element for element in restored["elements"]}
                        self.assertIs(elements["root"]["locked"], True)
                        self.assertIs(next(group for group in restored["groups"] if group["id"] == "locked")["locked"], True)
                        self.assertEqual(elements["body"]["luaMask"], expected["elements"][1]["luaMask"])
                        self.assertEqual(elements["body"]["luaMask"]["rotation"], -27)
                        self.assertTrue(elements["body"]["luaMask"]["reverseMaskArea"])

    def test_neutral_nested_groups_lua_drawing_equal_but_snapshot_retains_groups(self):
        sources = [normalize_scene(SceneDocumentModel.model_validate(payload))
                   for payload in neutral_group_scenes()]
        drawings, snapshots = [], []
        for source in sources:
            original = source.model_dump()
            script = export_lua(ExportRequest(scene=source)).body.decode("utf-8")
            drawing = lua_scene.read_drawing(script)
            metadata = json.loads(base64.b64decode(script.split(lua_scene.METADATA_PREFIX)[1].strip()))
            self.assertEqual(metadata["scene"], original)
            self.assertEqual(metadata["drawingHash"], lua_scene._digest(drawing))
            self.assertEqual(len(drawing["rows"]), 4)
            expected_import = copy.deepcopy(original)
            expected_import["meta"]["sourceType"] = "lua"
            self.assertEqual(parse_lua_scene(script).model_dump(), expected_import)
            self.assertEqual(source.model_dump(), original)
            drawings.append(drawing)
            snapshots.append(metadata["scene"])
        self.assertEqual(drawings[0], drawings[1])
        self.assertEqual(lua_scene._digest(drawings[0]), lua_scene._digest(drawings[1]))
        self.assertNotEqual(snapshots[0]["groups"], snapshots[1]["groups"])
        self.assertEqual([group["name"] for group in snapshots[1]["groups"][-3:]],
                         ["身体部件", "背景子组", "隐藏部件"])
        self.assertEqual(snapshots[1]["elements"][1]["groupId"], "parts")
        self.assertEqual(snapshots[1]["elements"][2]["groupId"], "nested")
        self.assertEqual(snapshots[1]["elements"][3]["groupId"], "hidden-parts")
        self.assertEqual(len(snapshots[1]["elements"]), 6)

    def test_json_import_without_groups_remains_compatible(self):
        payload = scene_dict()
        del payload["groups"]
        payload["elements"][0]["groupId"] = None
        restored = parse_json_scene(json.dumps(payload))
        self.assertEqual(restored.groups, [])
        self.assertEqual(len(restored.elements), 2)


if __name__ == "__main__":
    unittest.main()
