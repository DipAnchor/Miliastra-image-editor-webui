import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const js = ts.transpileModule(readFileSync(new URL("../src/elementCapabilities.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext }
}).outputText;
const {
  getElementCapabilities,
  CREATABLE_ELEMENT_TYPES,
  SMART_OBJECT_EDITABLE_FIELDS,
  ELEMENT_LIMITS
} = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));

const TYPES = ["ellipse", "rectangle", "triangle", "four_point_star", "five_point_star", "ring", "textbox", "image", "prefab", "smart-object", "other"];
const IMPORT_FORMATS = ["json", "css", "svg", "lua"];
const EXPORT_FORMATS = ["json", "css", "svg", "lua", "png", "gia", "container-node"];
const sorted = values => [...values].sort();
const capability = type => getElementCapabilities(type).elements[type];
const assertStrings = (values, label) => {
  assert.ok(Array.isArray(values), label);
  for (const value of values) assert.equal(typeof value, "string", label);
};
const assertFormat = (value, label) => {
  assert.ok(value && typeof value === "object", label);
  assert.equal(typeof value.status, "string", label);
  assert.ok(value.status.length > 0, label);
  assertStrings(value.notes, label);
};

test("omitted and undefined queries return all eleven element types", () => {
  const result = getElementCapabilities();
  assert.deepEqual(sorted(Object.keys(result.elements)), sorted(TYPES));
  assert.deepEqual(getElementCapabilities(undefined), result);
});

test("each valid type filters the catalog without losing shared metadata", () => {
  const all = getElementCapabilities();
  for (const type of TYPES) {
    const filtered = getElementCapabilities(type);
    assert.deepEqual(Object.keys(filtered.elements), [type]);
    assert.deepEqual(filtered.elements[type], all.elements[type]);
    for (const field of ["ok", "schemaVersion", "scope", "coordinates", "parameterLimits", "features"]) {
      assert.deepEqual(filtered[field], all[field], type + ": " + field);
    }
  }
});

test("unknown, empty and non-string types throw explanatory Errors", () => {
  for (const type of ["", "circle", "Rectangle", "__proto__", "constructor", "toString", null, 123, []]) {
    assert.throws(() => getElementCapabilities(type), error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /type|element|图元|类型|不支持|无效/i);
      return true;
    }, type);
  }
});

test("the type-level schema describes creation, editing, formats and previews for every type", () => {
  const result = getElementCapabilities();
  assert.equal(result.ok, true);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.scope, "type-level");
  for (const field of ["coordinates", "parameterLimits", "features"]) {
    assert.ok(result[field] && typeof result[field] === "object", field);
    assert.ok(Object.keys(result[field]).length > 0, field);
  }
  for (const [type, element] of Object.entries(result.elements)) {
    assert.equal(element.type, type);
    assert.equal(typeof element.creation.webmcp, "boolean", type);
    assertStrings(element.creation.requiredFields, type);
    assertStrings(element.creation.notes, type);
    assert.equal(typeof element.editing.webmcp, "boolean", type);
    assertStrings(element.editing.fields, type);
    assertStrings(element.editing.notes, type);
    assert.deepEqual(sorted(Object.keys(element.formats.import)), sorted(IMPORT_FORMATS), type);
    assert.deepEqual(sorted(Object.keys(element.formats.export)), sorted(EXPORT_FORMATS), type);
    for (const direction of ["import", "export"]) {
      for (const [format, value] of Object.entries(element.formats[direction])) assertFormat(value, type + ": " + direction + " " + format);
    }
    for (const preview of ["canvas", "png"]) assertFormat(element.preview[preview], type + ": " + preview);
    assert.ok(Array.isArray(element.constraints), type);
    for (const constraint of element.constraints) {
      assert.equal(typeof constraint.code, "string", type);
      assert.equal(typeof constraint.message, "string", type);
      assert.ok(constraint.code.length > 0 && constraint.message.length > 0, type);
    }
  }
});

test("the creation whitelist contains exactly the nine WebMCP creatable types", () => {
  const expected = TYPES.filter(type => type !== "smart-object" && type !== "other");
  assert.deepEqual(sorted(CREATABLE_ELEMENT_TYPES), sorted(expected));
  assert.equal(new Set(CREATABLE_ELEMENT_TYPES).size, 9);
  for (const type of TYPES) assert.equal(capability(type).creation.webmcp, expected.includes(type), type);
  assert.ok(capability("image").creation.requiredFields.includes("imageAssetId"));
  assert.ok(capability("prefab").creation.requiredFields.includes("prefabId"));
});

test("parameter limits expose numeric ranges including exclusive positive scale", () => {
  const { parameterLimits } = getElementCapabilities();
  for (const field of ["width", "height"]) {
    assert.equal(parameterLimits[field].minimum, 1, field);
    assert.equal(parameterLimits[field].maximum, 2048, field);
  }
  assert.equal(parameterLimits.opacity.minimum, 0);
  assert.equal(parameterLimits.opacity.maximum, 1);
  assert.equal(parameterLimits.fontSize.minimum, 1);
  assert.equal(parameterLimits.fontSize.maximum, 256);
  assert.equal(parameterLimits.scale.exclusiveMinimum, 0);
  assert.equal(parameterLimits.imageAssetId.minimum, 100000);
  assert.equal(parameterLimits.imageAssetId.maximum, 999999);
  assert.equal(parameterLimits.prefabId.minimum, 1);
  assert.equal(parameterLimits.prefabId.maximum, 4294967295);
  assert.ok(ELEMENT_LIMITS && typeof ELEMENT_LIMITS === "object");
  const sharedRanges = Object.values(ELEMENT_LIMITS).filter(value => value && typeof value === "object");
  assert.ok(sharedRanges.length > 0, "shared numeric limit objects are exported");
  for (const range of sharedRanges) {
    assert.ok(Object.values(range).some(value => typeof value === "number" && Number.isFinite(value)));
  }
});

test("smart objects expose only their editable container fields and require flattening outside JSON", () => {
  const smart = capability("smart-object");
  const fields = ["x", "y", "rotation", "scale", "opacity", "zIndex", "name", "layerName", "visible", "locked"];
  assert.equal(smart.creation.webmcp, false);
  assert.equal(smart.editing.webmcp, true);
  assert.deepEqual(sorted(SMART_OBJECT_EDITABLE_FIELDS), sorted(fields));
  assert.deepEqual(sorted(smart.editing.fields), sorted(fields));
  assert.equal(smart.formats.export.json.status, "supported");
  for (const format of EXPORT_FORMATS.filter(format => format !== "json")) {
    assert.equal(smart.formats.export[format].status, "conditional", format);
    assert.match(smart.formats.export[format].notes.join(" "), /flatten|展平|扁平/i, format);
  }
});

test("prefabs preserve JSON and Lua support while rejecting unsupported drawing exports", () => {
  const prefab = capability("prefab");
  for (const format of ["json", "lua"]) assert.equal(prefab.formats.export[format].status, "supported", format);
  for (const format of ["css", "svg", "png", "gia", "container-node"]) assert.equal(prefab.formats.export[format].status, "unsupported", format);
});

test("ring, triangle and image constraints expose their format-specific caveats", () => {
  const ring = capability("ring");
  const ringRatio = ring.constraints.find(constraint => constraint.code === "ring-ratio");
  assert.ok(ringRatio);
  assert.match(ringRatio.message, /0\.8/);
  assert.equal(ring.formats.export.svg.status, "omitted");
  assert.ok(capability("triangle").constraints.some(constraint => constraint.code === "triangle-orientation"));
  assert.ok(capability("image").constraints.some(constraint => constraint.code === "asset-dependent-stretch"));
});

test("luaMask feature metadata explains activation by enabled OR enableSoftEdge", () => {
  const luaMask = getElementCapabilities().features.luaMask;
  assert.ok(luaMask && typeof luaMask === "object");
  assert.ok(Object.keys(luaMask).length > 0);
  const details = JSON.stringify(luaMask);
  assert.match(details, /enabled/);
  assert.match(details, /enableSoftEdge/);
  assert.match(details, /\|\||\bor\b|或/i);
});

test("other elements remain non-creatable and disclose preservation versus lossy drawing fallbacks", () => {
  const other = capability("other");
  assert.equal(other.creation.webmcp, false);
  assert.equal(other.formats.export.json.status, "preserved-only");
  assert.equal(other.formats.export.lua.status, "preserved-only");
  for (const format of ["css", "svg", "png"]) assert.equal(other.formats.export[format].status, "lossy", format);
  assert.equal(other.formats.export.gia.status, "omitted");
  assert.equal(other.formats.export["container-node"].status, "unsupported");
});

test("mutating a query result cannot change subsequent catalog or filtered results", () => {
  const pristine = getElementCapabilities();
  const filtered = getElementCapabilities("rectangle");
  const changed = getElementCapabilities();
  changed.coordinates.testMutation = true;
  changed.parameterLimits.width.minimum = -1;
  changed.features.testMutation = true;
  changed.elements.rectangle.type = "other";
  changed.elements.rectangle.creation.requiredFields.push("testMutation");
  changed.elements.rectangle.creation.notes.push("testMutation");
  changed.elements.rectangle.editing.fields.push("testMutation");
  changed.elements.rectangle.editing.notes.push("testMutation");
  changed.elements.rectangle.formats.export.svg.notes.push("testMutation");
  changed.elements.rectangle.preview.canvas.notes.push("testMutation");
  changed.elements.rectangle.constraints.push({ code: "testMutation", message: "testMutation" });
  delete changed.elements.image;
  assert.deepEqual(getElementCapabilities(), pristine);
  assert.deepEqual(getElementCapabilities("rectangle"), filtered);
  assert.deepEqual(ELEMENT_LIMITS, pristine.parameterLimits);
});
