"""Mathematical checks only; these do not establish native API Euler order."""
import math
import random
import unittest

from app.rotation import masked_content_rotation


def multiply(left, right):
    return [[sum(left[i][k] * right[k][j] for k in range(3))
             for j in range(3)] for i in range(3)]


def rotation(x, y, z):
    # Independently compose elementary rotations rather than repeat the
    # production expanded matrix or its inverse-Euler extraction.
    x, y, z = map(math.radians, (x, y, z))
    cx, sx, cy, sy, cz, sz = math.cos(x), math.sin(x), math.cos(y), math.sin(y), math.cos(z), math.sin(z)
    rx = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]]
    ry = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]]
    rz = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]]
    return multiply(multiply(ry, rx), rz)


class MaskRotationMathTests(unittest.TestCase):
    def assert_pose(self, z, x, y, mask_z, tolerance=1e-10):
        child = masked_content_rotation(z, x, y, mask_z)
        self.assertTrue(all(math.isfinite(value) for value in child))
        actual = multiply(rotation(0, 0, mask_z), rotation(*child))
        expected = rotation(x, y, z)
        self.assertLessEqual(max(abs(actual[i][j] - expected[i][j])
                                 for i in range(3) for j in range(3)), tolerance,
                             (z, x, y, mask_z, child))
        return child

    def test_zero_or_complete_turn_mask_keeps_original_angles(self):
        for mask in (0, 360, -720):
            self.assertEqual(masked_content_rotation(27, 120, -35, mask), (120, -35, 27))
            self.assert_pose(27, 120, -35, mask)

    def test_pure_z_keeps_legacy_subtraction(self):
        for mask in (-137, 31, 90, 721):
            self.assertEqual(masked_content_rotation(-12, 0, 0, mask), (0, 0, -12 - mask % 360))
            self.assert_pose(-12, 0, 0, mask)

    def test_mixed_axes_need_more_than_z_subtraction(self):
        child = self.assert_pose(40, 30, 20, 31)
        self.assertAlmostEqual(child[0], 35.53055059437545)
        self.assertAlmostEqual(child[1], -0.255406945774645)
        self.assertAlmostEqual(child[2], 3.5081217099296538)
        naive = multiply(rotation(0, 0, 31), rotation(30, 20, 9))
        expected = rotation(30, 20, 40)
        self.assertGreater(max(abs(naive[i][j] - expected[i][j])
                               for i in range(3) for j in range(3)), 0.3)

    def test_positive_and_negative_gimbal_locks(self):
        for y in (-90, 90):
            for z in (-137, 0, 20, 170):
                child = self.assert_pose(z, 0, y, 90)
                self.assertAlmostEqual(abs(child[0]), 90)
                self.assertEqual(child[2], 0)

    def test_near_gimbal_locks_and_edge_on_projection(self):
        for offset in (-1e-7, -1e-11, 0, 1e-11, 1e-7):
            for y in (-90 + offset, 90 + offset):
                self.assert_pose(137, 0, y, 90)
        # A singular 2D projection is not a singular full 3D rotation.
        for x, y in ((90, 0), (-90, 20), (0, 90), (0, -90), (180, 180)):
            self.assert_pose(-137, x, y, 31)

    def test_original_sleeve_shadow_rotations(self):
        samples = (
            (-39.66056636460735, -24.94219249028913, -2.257031330458858, -38.049051265564),
            (-39.19257020177389, -24.89255994803068, -2.4513607119072276, -37.5810551027306),
        )
        for angles in samples:
            with self.subTest(angles=angles):
                self.assert_pose(*angles)

    def test_seeded_random_full_matrix_equivalence(self):
        rng = random.Random(20261124)
        for _ in range(2000):
            self.assert_pose(*(rng.uniform(-720, 720) for _ in range(4)))

    def test_nonfinite_angles_are_rejected(self):
        for index in range(4):
            for value in (math.nan, math.inf, -math.inf):
                args = [30, 20, 10, 40]
                args[index] = value
                with self.assertRaisesRegex(ValueError, "finite"):
                    masked_content_rotation(*args)


if __name__ == "__main__":
    unittest.main()
