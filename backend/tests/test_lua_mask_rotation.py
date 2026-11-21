import base64
import hashlib
import json
import os
import re
import subprocess
import tempfile
import unittest
from pathlib import Path

from fastapi import HTTPException
from pydantic import ValidationError

from app import lua_scene
from app.lua_mask import LuaMaskModel
from app.main import ExportRequest, export_lua, parse_json_scene, parse_lua_scene
from tests.test_lua_mask import scene


class LuaMaskRotationTests(unittest.TestCase):
    def test_rotation_roundtrip_json_library_and_lua_literals(self):
        source = scene()
        source.elements[0].luaMask.rotation = -47.5
        source.elements[1].rotationX = 0
        source.elements[1].luaMask.rotation = 90
        source.library.savedItems[0].element.luaMask.rotation = 540
        restored = parse_json_scene(source.model_dump_json())
        self.assertEqual(restored.elements, source.elements)
        self.assertEqual(restored.library, source.library)
        simplified = parse_json_scene(json.dumps({"elements": [source.elements[0].model_dump()]}))
        self.assertEqual(simplified.elements[0].luaMask.rotation, -47.5)
        script = export_lua(ExportRequest(scene=source)).body.decode()
        self.assertEqual(parse_lua_scene(script).elements, source.elements)
        self.assertEqual(parse_lua_scene(script).library, source.library)
        bare = parse_lua_scene(script.split(lua_scene.METADATA_PREFIX)[0])
        self.assertEqual([e.luaMask.rotation for e in bare.elements[:2]], [-47.5, 90])
        edited = parse_lua_scene(script.replace('["rotation"]=-47.5', '["rotation"]=17.25', 1))
        self.assertEqual(edited.elements[0].luaMask.rotation, 17.25)
        self.assertTrue(any("edited" in warning for warning in edited.meta.warnings))

    def test_rotation_defaults_and_strict_finite_values(self):
        self.assertEqual(LuaMaskModel().rotation, 0)
        for value in (-1080, 1080.25, 1e300):
            self.assertEqual(LuaMaskModel(rotation=value).rotation, value)
        script = export_lua(ExportRequest(scene=scene())).body.decode()
        for value in (True, False, None, "30", [], float("inf"), -float("inf"), float("nan")):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                LuaMaskModel(rotation=value)
        for literal in ('true', 'nil', '"30"', '1e999', 'os.time()'):
            with self.subTest(literal=literal), self.assertRaises(HTTPException):
                parse_lua_scene(script.replace('["rotation"]=0.0', '["rotation"]=' + literal, 1))

    def test_legacy_mask_rotation_omission_preserves_snapshot_hash(self):
        source = scene()
        body, payload = export_lua(ExportRequest(scene=source)).body.decode().split(lua_scene.METADATA_PREFIX)
        # Remove the new field only from mask records, independently reconstructing
        # the exact legacy drawing hash instead of accepting a normalized digest.
        body = re.sub(r'\["rotation"\]=0\.0,', '', body)
        drawing = lua_scene.read_drawing(body)
        for key in ("imageMasks", "textMasks"):
            for mask in drawing[key]:
                self.assertNotIn("rotation", mask)
        metadata = json.loads(base64.b64decode(payload))
        metadata["drawingHash"] = hashlib.sha256(json.dumps(drawing, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()
        for element in metadata["scene"]["elements"]:
            if element.get("luaMask"):
                element["luaMask"].pop("rotation", None)
        for saved in metadata["scene"]["library"]["savedItems"]:
            saved["element"]["luaMask"].pop("rotation", None)
        restored = parse_lua_scene(body + lua_scene.METADATA_PREFIX + base64.b64encode(json.dumps(metadata).encode()).decode())
        self.assertEqual(restored.elements, source.elements)
        self.assertEqual(restored.library, source.library)
        self.assertFalse(any("edited" in warning for warning in restored.meta.warnings))
        self.assertEqual(parse_lua_scene(body).elements[0].luaMask.rotation, 0)

    def test_rotated_mask_with_xy_tilt_refuses_unverified_pose_only_when_active(self):
        for rx, ry in ((30, 0), (0, 20), (30, 20), (180, 180)):
            source = scene()
            item = source.elements[1]
            item.rotationX, item.rotationY = rx, ry
            item.luaMask.rotation = 37
            self.assertEqual(parse_json_scene(source.model_dump_json()).elements[1].luaMask.rotation, 37)
            with self.subTest(rx=rx, ry=ry), self.assertRaises(HTTPException) as caught:
                export_lua(ExportRequest(scene=source))
            self.assertIn("text", caught.exception.detail)
            self.assertIn("exact pose", caught.exception.detail)
            item.luaMask.rotation = 360
            self.assertTrue(export_lua(ExportRequest(scene=source)).body)
            item.luaMask.rotation = 37
            item.luaMask.enabled = item.luaMask.enableSoftEdge = False
            self.assertTrue(export_lua(ExportRequest(scene=source)).body)

    @unittest.skipUnless(os.environ.get("FENGARI_MODULE_PATH"), "set FENGARI_MODULE_PATH for the Lua VM")
    def test_rotated_mask_runtime_keeps_world_geometry(self):
        source = scene()
        source.elements[1].rotationX = 0
        source.elements[1].textBox.scaleX = -1.2
        for angle in (-137, 45, 90, 360):
            for item in source.elements[:2]:
                item.luaMask.rotation = angle
            source.elements[0].luaMask.height = 43
            with self.subTest(angle=angle), tempfile.TemporaryDirectory(prefix="lua-mask-rotation-") as directory:
                lua_path, json_path = Path(directory) / "scene.lua", Path(directory) / "scene.json"
                lua_path.write_bytes(export_lua(ExportRequest(scene=source)).body)
                json_path.write_text(source.model_dump_json(), encoding="utf-8")
                result = subprocess.run(["node", str(Path(__file__).with_name("check_textbox_lua.cjs")),
                                         os.environ["FENGARI_MODULE_PATH"], str(lua_path), str(json_path)],
                                        capture_output=True, text=True, timeout=30)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
