import { rotationMatrix, type Rotation } from "./rotation";

type Matrix = ReturnType<typeof rotationMatrix>;
const RAD = Math.PI / 180;
const normalize = (angle: number) => ((angle % 360) + 360) % 360;
const difference = (a: number, b: number) => normalize(a - b + 180) - 180;
const multiply = (left: Matrix, right: Matrix): Matrix => ({
  a: left.a * right.a + left.c * right.b,
  b: left.b * right.a + left.d * right.b,
  c: left.a * right.c + left.c * right.d,
  d: left.b * right.c + left.d * right.d,
});

function closestEuler(matrix: Matrix, columns: [number, number][], original: Rotation): Rotation {
  const { a, b, c, d } = matrix;
  const cosineX = Math.hypot(b, d);
  let best = original, bestScore = Infinity;
  for (const [r13, r23] of columns) {
    for (const sign of [1, -1]) {
      const x = Math.atan2(-r23, sign * cosineX);
      let y: number, z: number;
      if (cosineX < 1e-12) {
        // At X = ±90°, only the combination Z − sin(X)Y is observable.
        y = (original.rotationY ?? 0) * RAD;
        z = Math.atan2(c, a) + Math.sign(-r23) * y;
      } else {
        z = Math.atan2(-sign * b, sign * d);
        // Recover Y from the visible row near a gimbal lock, where r13 and r33
        // both approach zero and their ratio loses accuracy.
        const sineX = Math.sin(x), cz = Math.cos(z), sz = Math.sin(z);
        y = Math.abs(sineX) > 0.5
          ? Math.atan2((a * sz - c * cz) / sineX, a * cz + c * sz)
          : Math.atan2(-sign * r13, sign * (a * d - b * c));
      }
      const candidate = { rotationX: normalize(x / RAD), rotationY: normalize(y / RAD), rotation: normalize(z / RAD) };
      const score = difference(candidate.rotationX, original.rotationX ?? 0) ** 2
        + difference(candidate.rotationY, original.rotationY ?? 0) ** 2
        + difference(candidate.rotation, original.rotation) ** 2;
      if (score < bestScore) { best = candidate; bestScore = score; }
    }
  }
  return best;
}

export function rotateProjectedLayer(original: Rotation, degrees: number): Rotation {
  const reference = { ...original, rotation: normalize(original.rotation + degrees) };
  if (!(original.rotationX || original.rotationY)) return reference;
  // The renderer uses Ry(-Y) Rx(X) Rz(-Z). A rigid screen-space rotation
  // multiplies on the left, including the missing entries of the first two rows.
  const world = rotationMatrix({ rotation: degrees });
  const matrix = multiply(world, rotationMatrix(original));
  const x = (original.rotationX ?? 0) * RAD, y = (original.rotationY ?? 0) * RAD;
  const r13 = -Math.sin(y) * Math.cos(x), r23 = -Math.sin(x);
  return closestEuler(matrix, [[world.a * r13 + world.c * r23, world.b * r13 + world.d * r23]], reference);
}

export function resizeProjectedLayer(original: Rotation, frameAngle: number, sx: number, sy: number):
  { rotation: Rotation; widthFactor: number; heightFactor: number } | null {
  const frame = rotationMatrix({ rotation: frameAngle });
  const world: Matrix = {
    a: sx * frame.a * frame.a + sy * frame.c * frame.c,
    b: (sx - sy) * frame.a * frame.b,
    c: (sx - sy) * frame.a * frame.b,
    d: sx * frame.b * frame.b + sy * frame.d * frame.d,
  };
  const originalMatrix = rotationMatrix(original);
  const target = multiply(world, originalMatrix);
  const xLength = Math.hypot(originalMatrix.a, originalMatrix.b), yLength = Math.hypot(originalMatrix.c, originalMatrix.d);
  const targetXLength = Math.hypot(target.a, target.b), targetYLength = Math.hypot(target.c, target.d);
  const xScale = xLength ? targetXLength / xLength : 1, yScale = yLength ? targetYLength / yLength : 1;
  if (!(xScale > 0 && yScale > 0 && Number.isFinite(xScale) && Number.isFinite(yScale))) return null;
  const base = { a: target.a / xScale, b: target.b / xScale, c: target.c / yScale, d: target.d / yScale };
  if (Math.hypot(base.a - originalMatrix.a, base.b - originalMatrix.b, base.c - originalMatrix.c, base.d - originalMatrix.d) <= 1e-12) {
    // If only local column lengths changed, preserve exact Euler values and don't invent tilt.
    return { rotation: original, widthFactor: xScale, heightFactor: yScale };
  }
  // Separate local dimensions from a linear screen-space map. Dividing the
  // remaining 2×2 block by its largest singular value makes it the orthographic
  // projection of a proper 3D rotation. Transfer that normalization to dimensions.
  const sum = Math.hypot(base.a + base.d, base.b - base.c);
  const diff = Math.hypot(base.a - base.d, base.b + base.c);
  const largest = (sum + diff) / 2;
  if (!(largest > 0)) return null;
  const matrix = { a: base.a / largest, b: base.b / largest, c: base.c / largest, d: base.d / largest };
  const { a, b, c, d } = matrix;
  // I − MMᵀ is rank one and supplies the missing entries in the first two
  // rows. Its nonzero eigenvalue is 1 − (σmin/σmax)²; this equivalent product
  // avoids subtracting almost equal values on almost-untilted layers.
  const major = Math.atan2(2 * (a * b + c * d), a * a + c * c - b * b - d * d) / 2;
  const missing = Math.sqrt(sum / largest) * Math.sqrt(diff / largest);
  const r13 = -Math.sin(major) * missing, r23 = Math.cos(major) * missing;
  return { rotation: closestEuler(matrix, [[r13, r23], [-r13, -r23]], original), widthFactor: xScale * largest, heightFactor: yScale * largest };
}
