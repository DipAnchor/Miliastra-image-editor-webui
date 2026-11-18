import copy
import json
import unittest

from fastapi import HTTPException
from unittest.mock import patch
from app import main
from test_smart_object_drawing import drawable_object


def scene_with_object():
    return {
        "canvas": {"width": 100, "height": 100},
        "schemaVersion": 2,
        "groups": [{"id": "outer"}],
        "elements": [{
            "type": "smart-object", "id": "object", "name": "徽章", "groupId": "outer",
            "x": 22, "y": 30, "rotation": -42, "scale": 0.75, "visible": False,
            "locked": True, "content": {
                "frame": {"width": 18.25, "height": 9.5},
                "groups": [{"id": "root"}, {"id": "sub", "parentId": "root", "opacity": 0.5}],
                "elements": [{"id": "leaf", "type": "ellipse", "groupId": "sub",
                              "x": -3.5, "y": 6, "width": 7, "height": 9,
                              "rotationX": 22, "locked": True, "visible": False}],
            },
        }],
    }


class SmartObjectPersistenceTests(unittest.TestCase):
    def test_json_roundtrip_preserves_object_and_library_copy(self):
        scene = scene_with_object()
        scene["library"] = {"savedItems": [{"id": "saved", "name": "副本",
                                             "element": copy.deepcopy(scene["elements"][0])}]}
        response = main.export_json(main.ExportRequest(scene=main.SceneDocumentModel.model_validate(scene)))
        exported = json.loads(response.body)
        obj = exported["elements"][0]
        self.assertEqual(obj["type"], "smart-object")
        self.assertEqual((obj["groupId"], obj["scale"], obj["rotation"]), ("outer", 0.75, -42))
        self.assertNotIn("width", obj)
        self.assertEqual(obj["content"]["frame"], {"width": 18.25, "height": 9.5})
        leaf = obj["content"]["elements"][0]
        self.assertEqual((leaf["x"], leaf["rotationX"], leaf["groupId"]), (-3.5, 22, "sub"))
        self.assertTrue(leaf["locked"])
        self.assertFalse(leaf["visible"])
        restored = main.parse_json_scene(json.dumps(exported)).model_dump()
        self.assertEqual(restored["elements"], exported["elements"])
        self.assertEqual(restored["library"]["savedItems"], exported["library"]["savedItems"])
        self.assertEqual(restored["schemaVersion"], 2)

    def test_invalid_content_is_rejected_by_json_import(self):
        def nested(obj):
            obj["content"]["elements"].append(copy.deepcopy(obj))

        for label, mutate in {
            "missing content": lambda obj: obj.pop("content"),
            "zero scale": lambda obj: obj.update(scale=0),
            "negative scale": lambda obj: obj.update(scale=-1),
            "infinite scale": lambda obj: obj.update(scale=float("inf")),
            "unsupported tilt": lambda obj: obj.update(rotationX=40),
            "bad frame": lambda obj: obj["content"]["frame"].update(width=0),
            "nonfinite leaf": lambda obj: obj["content"]["elements"][0].update(x=float("nan")),
            "duplicate id": lambda obj: obj["content"]["groups"][0].update(id="leaf"),
            "nested": nested,
            "dangling group": lambda obj: obj["content"]["elements"][0].update(groupId="outer"),
            "cycle": lambda obj: obj["content"]["groups"][0].update(parentId="sub"),
        }.items():
            with self.subTest(label=label):
                scene = scene_with_object()
                mutate(scene["elements"][0])
                with self.assertRaises(HTTPException) as caught:
                    main.parse_json_scene(json.dumps(scene))
                self.assertEqual(caught.exception.status_code, 400)

    def test_drawing_endpoints_flatten_visible_object(self):
        payload = drawable_object()
        request = main.ExportRequest(scene=main.SceneDocumentModel.model_validate(payload))
        for route in (main.export_css, main.export_svg, main.export_png, main.export_gia,
                      main.export_container_node, main.export_lua):
            with self.subTest(route=route.__name__):
                response = route(request)
                self.assertEqual(response.status_code, 200)
                self.assertTrue(response.body)

    def test_simplified_json_never_degrades_object_to_rectangle(self):
        scene = scene_with_object()
        for payload in (scene["elements"], {"elements": scene["elements"]}):
            with self.subTest(payload=type(payload).__name__):
                with self.assertRaises(HTTPException) as caught:
                    main.parse_json_scene(json.dumps(payload))
                self.assertEqual(caught.exception.status_code, 400)
                self.assertIn("complete JSON scene", caught.exception.detail)

    def test_nested_image_resolution_covers_scene_and_saved_objects(self):
        payload = scene_with_object()
        leaf = payload["elements"][0]["content"]["elements"][0]
        leaf.update(type="image", imageAssetId=100001)
        payload["library"] = {"savedItems": [{"id": "saved", "name": "image object",
                                             "element": copy.deepcopy(payload["elements"][0])}]}
        scene = main.SceneDocumentModel.model_validate(payload)
        with patch.object(main, "load_image_metas", return_value={100001: {"border": {"left": 2}}}) as load:
            resolved, _ = main.resolve_scene_image_types(main.normalize_scene(scene))
        self.assertEqual(set(load.call_args.args[0]), {100001})
        self.assertEqual(resolved.elements[0].content.elements[0].imageType, "stretch")
        self.assertEqual(resolved.library.savedItems[0].element.content.elements[0].imageType, "stretch")

    def test_object_version_is_upgraded_when_missing_and_unknown_is_rejected(self):
        payload = scene_with_object()
        payload.pop("schemaVersion")
        self.assertEqual(main.parse_json_scene(json.dumps(payload)).schemaVersion, 2)
        for version in (1, 3):
            with self.subTest(version=version):
                payload["schemaVersion"] = version
                with self.assertRaises(HTTPException) as caught:
                    main.parse_json_scene(json.dumps(payload))
                self.assertEqual(caught.exception.status_code, 400)
