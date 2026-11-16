import json
import unittest

from app.main import ExportRequest, SceneDocumentModel, export_json, normalize_scene


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


if __name__ == "__main__":
    unittest.main()
