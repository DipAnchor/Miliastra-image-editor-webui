"""Independent protobuf-wire checks for per-element client image masks."""
import copy
import hashlib
import math
import struct
import unittest

from app.client_ui_export import build_container_node_gia


def wire(data):
    fields = {}
    pos = 0

    def varint():
        nonlocal pos
        value = shift = 0
        while True:
            byte = data[pos]
            pos += 1
            value |= (byte & 127) << shift
            if byte < 128:
                return value
            shift += 7

    while pos < len(data):
        key = varint()
        tag, kind = key >> 3, key & 7
        if kind == 0:
            value = varint()
        elif kind == 2:
            size = varint()
            value = data[pos:pos + size]
            pos += size
        elif kind == 5:
            value = struct.unpack_from('<f', data, pos)[0]
            pos += 4
        else:
            raise AssertionError(f'Unexpected wire type {kind}')
        fields.setdefault(tag, []).append((kind, value))
    return fields


def value(fields, tag, default=0):
    return fields.get(tag, [(None, default)])[0][1]


def message(fields, tag):
    return wire(value(fields, tag, b''))


def units(data):
    root = wire(data[20:-4])
    return [wire(value(root, 1))] + [wire(item) for _, item in root.get(2, [])]


def meta(unit):
    return message(message(unit, 19), 1)


def identity(unit):
    return value(message(unit, 1), 4)


def body(unit, kind, tag):
    components = [wire(data) for _, data in meta(unit)[505]]
    component = next(item for item in components if value(item, 502) == kind)
    return message(message(component, 503), tag)


def rect(unit):
    multi = message(body(unit, 12, 13), 12)
    platforms = [message(wire(data), 502) for _, data in multi[501]]
    assert all(item == platforms[0] for item in platforms)
    return platforms[0]


def vector(fields, tag, axes=(501, 502)):
    inner = message(fields, tag)
    return tuple(value(inner, axis) for axis in axes)


def children(unit):
    return [value(wire(data), 4) for _, data in unit.get(2, [])]


def matrix(x, y, z):
    x, y, z = map(math.radians, (x, y, z))
    cx, sx, cy, sy, cz, sz = math.cos(x), math.sin(x), math.cos(y), math.sin(y), math.cos(z), math.sin(z)
    return ((cy*cz+sy*sx*sz, -cy*sz+sy*sx*cz, sy*cx),
            (cx*sz, cx*cz, -sx),
            (-sy*cz+cy*sx*sz, sy*sz+cy*sx*cz, cy*cx))


def multiply(a, b):
    return tuple(tuple(sum(a[i][k]*b[k][j] for k in range(3)) for j in range(3)) for i in range(3))


def scene():
    return {'canvas': {'width': 200, 'height': 160}, 'elements': [
        {'type': 'rectangle', 'x': 120, 'y': 90, 'width': 12, 'height': 20,
         'rotation': 30, 'color': '#123456'}]}


class ClientMaskWireTests(unittest.TestCase):
    def test_no_mask_bytes_and_inactive_mask_are_unchanged(self):
        source = scene()
        baseline = build_container_node_gia(source)
        self.assertEqual(hashlib.sha256(baseline).hexdigest(),
                         'bbeee18e68782b655f12a4022807099430eaac961f821672b745b4a32b91dcb0')
        source['elements'][0]['luaMask'] = {'enabled': False, 'enableSoftEdge': False,
                                          'reverseMaskArea': True, 'rotation': 25}
        self.assertEqual(build_container_node_gia(source), baseline)
        self.assertEqual(value(body(units(baseline)[1], 96, 84), 504), 1)

    def test_reverse_mask_image_and_fallback_size(self):
        source = scene()
        source['elements'][0]['luaMask'] = {'enabled': True, 'imageId': 100003,
            'imageType': None, 'reverseMaskArea': True, 'offsetX': 6, 'offsetY': 8,
            'width': None, 'height': None}
        before = copy.deepcopy(source)
        root, mask, child = units(build_container_node_gia(source))
        self.assertEqual(source, before)
        self.assertEqual(children(root), [identity(mask)])
        self.assertEqual(children(mask), [identity(child)])
        self.assertEqual(value(meta(child), 504), identity(mask))
        self.assertEqual(vector(rect(mask), 504), (26, -18))
        self.assertEqual(vector(rect(mask), 505), (12, 20))
        self.assertEqual(vector(rect(child), 504), (-6, 8))
        image = body(mask, 96, 84)
        self.assertEqual(value(image, 502), 0x00ffffff)
        self.assertEqual(value(image, 503), 100003)
        self.assertEqual(value(image, 504), 0)  # basic / absent proto3 zero
        config = body(mask, 97, 85)
        self.assertEqual(value(config, 501), 1)
        self.assertEqual(value(config, 516), 1)
        self.assertEqual(value(config, 509), 0)
        self.assertEqual(value(body(child, 96, 84), 504), 1)  # content stays Stretch

    def test_feather_only_mask_both_modes_and_float_wire_fields(self):
        for mode, pixel in [('Pixel', 1), ('Percentage', 0)]:
            with self.subTest(mode=mode):
                source = scene()
                source['elements'][0]['luaMask'] = {'enabled': False, 'enableSoftEdge': True,
                    'imageType': 'stretch', 'width': 44, 'height': 32, 'softEdgeMode': mode,
                    'softEdgeWidthX': 2.25, 'softEdgeWidthY': 7.5,
                    'horizontalSoftRange': 64.5, 'verticalSoftRange': 83.25}
                _, mask, _ = units(build_container_node_gia(source))
                self.assertEqual(vector(rect(mask), 505), (44, 32))
                self.assertEqual(value(body(mask, 96, 84), 504), 1)
                config = body(mask, 97, 85)
                self.assertEqual(value(config, 501), 1)  # feather must enable native mask
                self.assertEqual(value(config, 509), 1)
                self.assertEqual(value(config, 510), pixel)
                self.assertEqual(vector(config, 511), (2.25, 7.5))
                self.assertEqual(message(config, 511)[501][0][0], 5)
                self.assertEqual(message(config, 511)[502][0][0], 5)
                self.assertEqual(config[512], [(5, 64.5)])
                self.assertEqual(config[513], [(5, 83.25)])

    def test_explicit_zero_feather_parameters_survive_wire_encoding(self):
        for mode in ('Pixel', 'Percentage'):
            for width_x, width_y, range_x, range_y in ((0, 0, 0, 0), (24, 0, 0, 100), (0, 16, 100, 0)):
                with self.subTest(mode=mode, widths=(width_x, width_y), ranges=(range_x, range_y)):
                    source = scene()
                    source['elements'][0]['luaMask'] = {
                        'enabled': True, 'enableSoftEdge': True, 'imageType': 'basic',
                        'softEdgeMode': mode, 'softEdgeWidthX': width_x, 'softEdgeWidthY': width_y,
                        'horizontalSoftRange': range_x, 'verticalSoftRange': range_y,
                    }
                    _, mask, _ = units(build_container_node_gia(source))
                    config = body(mask, 97, 85)
                    widths = message(config, 511)
                    self.assertEqual(widths.get(501), [(5, width_x)])
                    self.assertEqual(widths.get(502), [(5, width_y)])
                    self.assertEqual(config.get(512), [(5, range_x)])
                    self.assertEqual(config.get(513), [(5, range_y)])

    def test_rotated_mask_preserves_world_position_and_full_tilt(self):
        for angles in [(0, 0, 30), (25, -40, 70), (90, 0, 15), (-89.99, 70, -20)]:
            with self.subTest(angles=angles):
                source = scene()
                element = source['elements'][0]
                element.update(rotationX=angles[0], rotationY=angles[1], rotation=angles[2])
                element['luaMask'] = {'enabled': True, 'offsetX': 6, 'offsetY': 8, 'rotation': 37}
                _, mask, child = units(build_container_node_gia(source))
                self.assertEqual(vector(rect(mask), 508, (1, 2, 3)), (0, 0, 37))
                mx, my = vector(rect(mask), 504)
                x, y = vector(rect(child), 504)
                c, s = math.cos(math.radians(37)), math.sin(math.radians(37))
                self.assertAlmostEqual(mx+c*x-s*y, 20, places=5)
                self.assertAlmostEqual(my+s*x+c*y, -10, places=5)
                actual = multiply(matrix(0, 0, 37), matrix(*vector(rect(child), 508, (1, 2, 3))))
                expected = matrix(*angles)
                for row in range(3):
                    for col in range(3):
                        self.assertAlmostEqual(actual[row][col], expected[row][col], places=5)

    def test_canvas_mask_stacks_with_element_masks_and_ordered_unique_guids(self):
        source = scene()
        source['canvas']['mask'] = {'enabled': True, 'shapeType': 1, 'x': 10, 'y': 15,
                                    'width': 70, 'height': 50}
        source['elements'] += [dict(source['elements'][0], zIndex=1), dict(source['elements'][0], zIndex=2)]
        source['elements'][0]['luaMask'] = {'enabled': True, 'offsetX': 6, 'offsetY': 8}
        source['elements'][2]['luaMask'] = {'enableSoftEdge': True}
        before = copy.deepcopy(source)
        result = units(build_container_node_gia(source))
        self.assertEqual(source, before)
        self.assertEqual([identity(unit) for unit in result], list(range(1073741825, 1073741832)))
        root, canvas, mask1, image1, image2, mask3, image3 = result
        self.assertEqual(children(root), [identity(canvas)])
        self.assertEqual(children(canvas), [identity(mask1), identity(image2), identity(mask3)])
        self.assertEqual(vector(rect(canvas), 504), (10, 15))
        self.assertEqual(vector(rect(mask1), 504), (16, -33))
        self.assertEqual(vector(rect(image2), 504), (10, -25))
        for parent, child in [(canvas, mask1), (mask1, image1), (canvas, image2), (canvas, mask3), (mask3, image3)]:
            self.assertEqual(value(meta(child), 504), identity(parent))


if __name__ == '__main__':
    unittest.main()
