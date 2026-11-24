import copy
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from app.main import ExportRequest, SceneDocumentModel, export_container_node, require_supported_draw_format
from test_client_ui_export import sample_scene, decode, body
from vendor.primitive_shape.gia_lua import _get


class ContainerMaskEndpointTests(unittest.TestCase):
    def scene(self):
        scene = sample_scene()
        scene["elements"] = [scene["elements"][1]]
        scene["elements"][0]["luaMask"] = {"enabled": True, "imageId": 100002}
        return SceneDocumentModel(**scene)

    def test_default_type_is_resolved_only_in_export_copy(self):
        for border, expected in (({}, 0), ({"left": 4}, 1)):
            with self.subTest(border=border):
                scene = self.scene()
                before = copy.deepcopy(scene.model_dump())
                with patch("app.main.load_image_metas", return_value={100002: {"border": border}}) as loader:
                    response = export_container_node(ExportRequest(scene=scene))
                self.assertEqual(response.status_code, 200)
                loader.assert_called_once_with([100002])
                _, _, units = decode(response.body)
                self.assertEqual(len(units), 3)
                self.assertEqual(_get(body(units[1], 96, 84), 504, default=0), expected)
                self.assertEqual(_get(body(units[1], 97, 85), 501), 1)
                self.assertEqual(scene.model_dump(), before)

    def test_explicit_type_needs_no_metadata_and_missing_default_is_reported(self):
        scene = self.scene()
        scene.elements[0].luaMask.imageType = "basic"
        with patch("app.main.load_image_metas") as loader:
            self.assertEqual(export_container_node(ExportRequest(scene=scene)).status_code, 200)
        loader.assert_not_called()
        with patch("app.main.load_image_metas", return_value={}):
            with self.assertRaises(HTTPException) as error:
                export_container_node(ExportRequest(scene=self.scene()))
        self.assertEqual(error.exception.status_code, 400)
        self.assertIn("metadata unavailable", error.exception.detail)

    def test_other_drawing_formats_still_reject_masks(self):
        for label in ("GIA", "SVG", "CSS", "PNG"):
            with self.subTest(format=label), self.assertRaises(HTTPException) as error:
                require_supported_draw_format(self.scene(), label)
            self.assertEqual(error.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
