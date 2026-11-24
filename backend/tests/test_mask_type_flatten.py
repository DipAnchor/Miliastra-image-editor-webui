import unittest
from unittest.mock import patch
from fastapi import HTTPException
from app import main
from test_smart_object_drawing import drawable_object


def source(mask_type=None, **object_fields):
    payload = drawable_object(**object_fields)
    leaf = payload['elements'][0]['content']['elements'][0]
    leaf['luaMask'] = dict(enabled=True, imageId=100003, imageType=mask_type)
    return main.SceneDocumentModel.model_validate(payload)


class MaskTypeFlattenTests(unittest.TestCase):
    def test_default_basic_exports_without_mutating_source_or_snapshot(self):
        scene = source()
        before = scene.model_dump()
        with patch.object(main, 'load_image_metas', return_value={100003: {'border': {'left': 0}}}):
            flat = main.flatten_drawing_scene(scene)
            script = main.export_lua(main.ExportRequest(scene=scene)).body.decode()
        self.assertEqual(flat.elements[0].luaMask.imageType, 'basic')
        self.assertEqual(scene.model_dump(), before)
        self.assertEqual(main.parse_lua_scene(script).elements, main.normalize_scene(scene).elements)

    def test_border_default_and_explicit_stretch_remain_rejected(self):
        for kind in (None, 'stretch'):
            with self.subTest(kind=kind), patch.object(main, 'load_image_metas', return_value={100003: {'border': {'left': 2}}}):
                with self.assertRaises(HTTPException) as caught:
                    main.flatten_drawing_scene(source(kind))
                self.assertIn('not scalable', caught.exception.detail)

    def test_missing_metadata_does_not_guess_basic(self):
        with patch.object(main, 'load_image_metas', return_value={}):
            with self.assertRaises(HTTPException) as caught:
                main.flatten_drawing_scene(source())
        self.assertIn('100003', caught.exception.detail)
        self.assertIn('metadata', caught.exception.detail)

    def test_explicit_basic_hidden_and_unscaled_do_not_load_mask_metadata(self):
        for scene in (source('basic'), source(visible=False), source(scale=1)):
            with self.subTest(scene=scene.elements[0].scale), patch.object(main, 'load_image_metas', return_value={}) as load:
                main.flatten_drawing_scene(scene)
            self.assertFalse(any(100003 in call.args[0] for call in load.call_args_list))

    def test_repeated_mask_id_is_loaded_once_and_supplied_metadata_is_used(self):
        scene = source()
        obj = scene.elements[0]
        obj.content.elements.append(obj.content.elements[0].model_copy(update={'id': 'second'}))
        with patch.object(main, 'load_image_metas', return_value={100003: {'border': {}}}) as load:
            flat = main.flatten_drawing_scene(scene)
        self.assertEqual(len(flat.elements), 2)
        self.assertEqual(sum(100003 in call.args[0] for call in load.call_args_list), 1)
        with patch.object(main, 'load_image_metas') as load:
            main.flatten_drawing_scene(scene, {100003: {'border': {}}})
        load.assert_not_called()
