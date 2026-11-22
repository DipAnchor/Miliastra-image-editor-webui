/** Type-level editor contract; per-asset/per-scene checks still run at execution. */
export const CREATABLE_ELEMENT_TYPES = [
  "ellipse", "rectangle", "triangle", "four_point_star", "five_point_star", "ring", "textbox", "image", "prefab"
] as const;
export const KNOWN_ELEMENT_TYPES = [...CREATABLE_ELEMENT_TYPES, "smart-object", "other"] as const;
type ElementType = typeof KNOWN_ELEMENT_TYPES[number];

export const SMART_OBJECT_EDITABLE_FIELDS = [
  "x", "y", "rotation", "scale", "opacity", "zIndex", "name", "layerName", "visible", "locked"
] as const;
export const ELEMENT_LIMITS = {
  width: { minimum: 1, maximum: 2048 },
  height: { minimum: 1, maximum: 2048 },
  opacity: { minimum: 0, maximum: 1 },
  fontSize: { minimum: 1, maximum: 256 },
  imageAssetId: { minimum: 100000, maximum: 999999 },
  prefabId: { minimum: 1, maximum: 4294967295 },
  scale: { exclusiveMinimum: 0 }
} as const;

type Status = "supported" | "conditional" | "lossy" | "omitted" | "unsupported" | "preserved-only" | "approximate";
type Support = { status: Status; notes: string[] };
type Constraint = { code: string; message: string };
type ElementCapability = {
  type: ElementType;
  creation: { webmcp: boolean; requiredFields: string[]; notes: string[] };
  editing: { webmcp: boolean; fields: string[]; notes: string[] };
  formats: {
    import: Record<"json" | "css" | "svg" | "lua", Support>;
    export: Record<"json" | "css" | "svg" | "lua" | "png" | "gia" | "container-node", Support>;
  };
  preview: { canvas: Support; png: Support };
  constraints: Constraint[];
};
const support = (status: Status, ...notes: string[]): Support => ({ status, notes });
const LEAF_FIELDS = ["name", "layerName", "x", "y", "width", "height", "rotation", "rotationX", "rotationY", "color", "opacity", "zIndex", "isBackground", "visible", "locked", "groupId"];
const CSS_SUBSET = "Only the editor-compatible CSS subset is parsed: explicit left/top/width/height and recognized shape templates; not arbitrary browser CSS.";
const SVG_SUBSET = "Ordinary SVG supports rect/circle/ellipse/three-point polygon/text/image subsets, not general paths or arbitrary transforms. Basic-shape rotations are not preserved on ordinary import. Projected g[data-miliastra-element] metadata is a separate leaf-restoration path.";
const LUA_IMPORT = "Imports supported ROOT/ELEMENTS or legacy image-data tables, not arbitrary Lua execution. Full editor structure is restored from editor_scene only while its drawing-data digest matches; otherwise current drawing records are rebuilt with a warning.";
const JSON_MODEL = "Normalized editor scene JSON, not arbitrary JSON or byte-for-byte preservation. Normalization may change colors, dimensions and zIndex.";
const BLOCKED_DRAWING_FORMATS = ["css", "svg", "png", "gia", "container-node"];

function capability(type: ElementType): ElementCapability {
  const creatable = (CREATABLE_ELEMENT_TYPES as readonly string[]).includes(type);
  const entry: ElementCapability = {
    type,
    creation: { webmcp: creatable, requiredFields: creatable ? ["type"] : [], notes: [] },
    editing: { webmcp: true, fields: [...LEAF_FIELDS, "luaMask"], notes: ["Fields list meaningful WebMCP input keys for this type. Omitted update fields are preserved; this table does not replace target validation."] },
    formats: {
      import: { json: support("supported", JSON_MODEL), css: support("conditional", CSS_SUBSET), svg: support("conditional", SVG_SUBSET), lua: support("conditional", LUA_IMPORT) },
      export: { json: support("supported", JSON_MODEL), css: support("supported"), svg: support("supported"), lua: support("supported", "Requires the configured client control templates and script setup; no blanket device-verification claim."), png: support("supported"), gia: support("supported", "Material-group GIA; distinct from container-node GIA."), "container-node": support("supported", "Client UIControlTemplate container-node GIA, not the material-group protocol. Canvas clipping is rectangular only.") }
    },
    preview: { canvas: support("supported", "Editor preview, not proof of identical device rendering."), png: support("supported") },
    constraints: []
  };
  if (type === "triangle") entry.constraints.push({ code: "triangle-orientation", message: "Unrotated triangle points up; rotation is counter-clockwise in degrees." });
  if (type === "ring") {
    entry.constraints.push({ code: "ring-ratio", message: "Fixed inner/outer diameter ratio 0.8; no independent ring-thickness field." });
    entry.formats.import.svg = support("unsupported", "Ordinary SVG annulus/path input is not recognized as a ring. Use JSON, the supported CSS ring template, or matching Lua editor metadata.");
    entry.formats.export.svg = support("omitted", "The exporter skips rings before all SVG drawing/projection branches and emits a Miliastra-Warning; no ring metadata survives that export.");
  }
  if (type === "four_point_star" || type === "five_point_star") {
    entry.formats.import.svg = support("conditional", "Ordinary star polygons are skipped because only three-point polygons import. Only the exporter's projected g[data-miliastra-element] leaf metadata can restore star types.");
    entry.formats.export.svg.notes.push("Exports a visible polygon, but ordinary polygon reimport cannot restore the star. XY-projected exports carry separate leaf metadata.");
  }
  if (type === "textbox") {
    entry.editing.fields.push("text", "fontSize");
    entry.constraints.push({ code: "textbox-markup", message: "Text supports the editor's color/i/size markup subset. WebMCP exposes text and fontSize, not every persisted textBox setting." });
    entry.formats.import.css.notes.push("Textbox content requires content or editor-specific text fields.");
    entry.formats.import.svg = support("lossy", SVG_SUBSET, "Ordinary SVG text does not preserve the complete editor rich-text, anchor or rotation model.");
    entry.formats.export.css = support("conditional", "Uses the editor text CSS representation; complete rich-text and textBox round-trip preservation is not promised.");
    entry.formats.export.svg = support("lossy", "SVG text output does not preserve the complete editor rich-text and textBox model.");
    entry.formats.export.lua = support("conditional", "Requires the configured text control template and supported text settings.");
    entry.formats.export.png = support("lossy", "Pillow/font and rich-text rendering differ from the browser and native client; do not infer pixel-identical text.");
    entry.formats.export["container-node"] = support("unsupported", "Container-node GIA accepts six basic shapes and images only; textbox rejects the export.");
    entry.preview.png = entry.formats.export.png;
  }
  if (type === "image") {
    entry.creation.requiredFields.push("imageAssetId");
    entry.creation.notes.push("Call get_asset_info with a real six-digit library sprite ID before choosing mode or dimensions.");
    entry.editing.fields.push("imageAssetId", "imageTint", "imageType");
    entry.constraints.push({ code: "asset-dependent-stretch", message: "basic is whole-image scaling. stretch requires at least one nonzero m_Border slice; zero/missing borders allow basic only. get_asset_info returns actual imageTypes/defaultImageType/defaultSize. A thumbnail is not evidence of stretch capability." });
    entry.formats.import.json = support("conditional", JSON_MODEL, "Requires a valid imageAssetId; missing/invalid IDs can normalize to rectangle.");
    entry.formats.export.json = support("conditional", "Preserves normalized image configuration; the external sprite is not embedded in scene JSON.");
    entry.formats.import.css.notes.push("Library image requires the -miliastra-image field; arbitrary CSS backgrounds are not a general image importer.");
    entry.formats.import.svg.notes.push("Requires data-miliastra-image or a recognized /sprite/six-digit-id.png URL; arbitrary embedded images are not supported.");
    entry.formats.export.css = support("conditional", "Depends on library sprite resources. Stretch rendering is baked to PNG for CSS output.");
    entry.formats.export.svg = support("conditional", "Stretch rendering is baked to PNG. Basic+imageTint emits the original sprite and a warning, losing tint.");
    entry.formats.export.lua = support("conditional", "Requires configured image control template and a valid sprite/mode; native resource and device behavior remain separate checks.");
    entry.formats.export.png = support("conditional", "Downloads source sprite; a failed resource is skipped with a PNG warning, so inspect output and warnings.");
    entry.formats.export.gia = support("conditional", "Requires valid image resource/configuration; material-group GIA is not the container-node protocol.");
    entry.formats.export["container-node"] = support("conditional", "Requires a valid image resource/configuration. Container-node GIA always encodes Stretch (scale mode 1); a Basic selection is not preserved.");
    entry.preview.canvas = support("conditional", "Requires source sprite and metadata. Renders Basic/Stretch from the original sprite rather than the fixed stretch-preview thumbnail.");
    entry.preview.png = entry.formats.export.png;
  }
  if (type === "prefab") {
    entry.creation.requiredFields.push("prefabId");
    entry.creation.notes.push("Call get_prefab_info first: only catalog entries with thumbnails can be added; prefabId is an entity ID, not an imageAssetId or client template index.");
    entry.editing.fields.push("prefabId", "prefabVariable");
    entry.constraints.push({ code: "lua-only-prefab", message: "Prefab content draws only in Lua using ImageSource.Prefab and script-local PREFAB_IDS. Its presence blocks CSS/SVG/PNG/material-GIA/container-node export; JSON stores configuration, not the resource." });
    entry.formats.import.json = support("conditional", JSON_MODEL, "Requires a positive uint32 prefabId and a valid prefabVariable configuration name.");
    entry.formats.export.json.notes.push("Stores prefab configuration only; the external prefab asset is not embedded.");
    entry.formats.import.css = support("unsupported", "CSS cannot import prefab entity references.");
    entry.formats.import.svg = support("unsupported", "SVG cannot import prefab entity references.");
    for (const format of BLOCKED_DRAWING_FORMATS) entry.formats.export[format as keyof typeof entry.formats.export] = support("unsupported", "Prefab is Lua-only; this format rejects the export instead of drawing its preview thumbnail.");
    entry.formats.export.lua.notes.push("Use get_prefab_info to verify catalog identity; device availability and template initialization are separate requirements.");
    entry.preview.canvas = support("conditional", "Catalog thumbnail preview only, not rendering the actual native prefab. Unknown resources show a placeholder.");
    entry.preview.png = entry.formats.export.png;
  }
  if (type === "smart-object") {
    entry.creation.notes.push("Not creatable with add_element(s)/set_elements. Convert a group in the editor, or import a complete scene JSON / valid matching Lua editor snapshot.");
    entry.editing.fields = [...SMART_OBJECT_EDITABLE_FIELDS];
    entry.editing.notes = ["Only the shell whitelist is accepted; unsupported fields fail the whole batch. Use positive uniform scale, not width/height, color, groupId or X/Y tilt. Edit internal contents through the editor's object session."];
    entry.formats.import.json = support("conditional", JSON_MODEL, "Requires a complete scene document with canvas/elements; simplified elements-only and array import reject smart objects.");
    entry.formats.import.css = support("unsupported", "CSS imports leaves, not smart-object shells.");
    entry.formats.import.svg = support("unsupported", "SVG leaf metadata does not restore an object shell.");
    entry.formats.import.lua.notes.push("Object shell survives only through the unchanged drawing-digest editor snapshot.");
    for (const format of [...BLOCKED_DRAWING_FORMATS, "lua"]) entry.formats.export[format as keyof typeof entry.formats.export] = support("conditional", "Flattens visible content to leaves before drawing; inherits all leaf/mask/prefab restrictions and may reject nonrepresentable geometry. JSON preserves the shell; matching Lua snapshots can restore it.");
    entry.preview.canvas = support("conditional", "Editor recursively previews contents; not a guarantee that every flattened export or native device can express the composition.");
    entry.preview.png = entry.formats.export.png;
    entry.constraints.push(
      { code: "object-scale", message: "Finite positive uniform scale; size derives from content.frame times scale. No nested smart objects." },
      { code: "exact-flattening", message: "Drawing export rejects unrepresentable mixed-axis rotations, scaled stretch images, incompatible transformed masks, noncenter text anchors, invalid fractional scaled font sizes, undersized or nonfinite output geometry. It does not silently approximate these cases." },
      { code: "object-frame", message: "The object frame is not a clipping mask. Hidden leaves are skipped in drawing exports. Composed group/object opacity is multiplied into each visible leaf, not applied to an offscreen whole-group composite; overlapping leaves may therefore look different." }
    );
  }
  if (type === "other") {
    entry.creation.notes.push("Legacy known type, unavailable for direct AI creation. Preservation does not imply native drawing support.");
    entry.editing.fields = [...LEAF_FIELDS];
    entry.constraints.push({ code: "legacy-other", message: "Unknown legacy geometry is not implemented as a distinct drawing primitive. Active Lua masks on other are rejected." });
    entry.formats.import.json = support("preserved-only", JSON_MODEL, "Keeps the known type and supported fields, not arbitrary unknown geometry.");
    entry.formats.export.json = support("preserved-only", "Keeps the legacy type/fields without establishing a drawing implementation.");
    entry.formats.import.css = support("unsupported", "CSS fallback imports as rectangle, not other.");
    entry.formats.import.svg = support("conditional", "Only projected editor leaf metadata can restore other; ordinary fallback SVG imports as rectangle.");
    entry.formats.import.lua = support("preserved-only", LUA_IMPORT, "Retained only in a valid editor snapshot, never drawn by Lua.");
    entry.formats.export.lua = support("preserved-only", "Stored only in the editor snapshot; no Lua drawing record.");
    for (const format of ["css", "svg", "png"] as const) entry.formats.export[format] = support("lossy", "Generic fallback draws a rectangle, not the original unknown geometry.");
    entry.formats.export.gia = support("omitted", "Material-group GIA skips other; export fails if no drawable elements remain.");
    entry.formats.export["container-node"] = support("unsupported", "Container-node GIA rejects other.");
    entry.preview.canvas = support("lossy", "Generic rectangular fallback only.");
    entry.preview.png = entry.formats.export.png;
  }
  return entry;
}

/** No scene, storage, DOM, network or runtime capability probing. */
export function getElementCapabilities(type?: string) {
  if (type !== undefined && (typeof type !== "string" || !(KNOWN_ELEMENT_TYPES as readonly string[]).includes(type))) {
    throw new Error(`type must be one of ${KNOWN_ELEMENT_TYPES.join(" / ")}`);
  }
  const selected = type === undefined ? KNOWN_ELEMENT_TYPES : [type as ElementType];
  return structuredClone({
    ok: true as const, schemaVersion: 1, scope: "type-level" as const,
    coordinates: { unit: "px", origin: "top-left", xAxis: "right", yAxis: "down", position: "box-center", rotation: { unit: "degrees", positive: "counter-clockwise", projectionOrder: "Ry * Rx * Rz" }, stacking: "Larger zIndex is above; edits normalize ordering." },
    parameterLimits: ELEMENT_LIMITS,
    features: {
      interpretation: "Apply global restrictions before per-type format statuses. supported means this implementation has a path, not lossless round-trip or native-device proof.",
      luaMask: {
        activation: "enabled || enableSoftEdge", activationFields: ["enabled", "enableSoftEdge"],
        storageFormats: ["json"], drawingFormats: ["lua"], blockedDrawingFormats: BLOCKED_DRAWING_FORMATS, unsupportedTypes: ["other", "smart-object shell"],
        geometry: {
          position: { fields: ["offsetX", "offsetY"], unit: "px", origin: "element-center", xAxis: "right", yAxis: "down" },
          size: { fields: ["width", "height"], unit: "px", axes: "mask-local", null: "follows corresponding content dimension" },
          rotation: { field: "rotation", unit: "degrees", positive: "counter-clockwise", pivot: "mask-center", default: 0 }
        },
        notes: [
          "Inactive retained settings do not block exports. Active effects reject other drawing formats for the whole scene; editor checks also conservatively scan hidden object contents.",
          "WebMCP field updates do not apply the editor Transform operation. Patch luaMask geometry alongside element geometry when needed; null mask dimensions follow the element.",
          "Reverse coverage only within the rotated mask bounds; outside stays clipped. Pixel uses softEdgeWidthX/Y; Percentage uses horizontalSoftRange/verticalSoftRange. Canvas contours and feathering are approximations; failures show original content plus a notice.",
          "get_canvas_preview uses PNG export for PNG and JPEG and cannot render active element masks. The editor canvas can show them; mask drafts and guides are editor-only.",
          "Lua drawing rejects an active mask with rotation modulo 360 nonzero combined with nonzero content X/Y tilt. JSON can preserve this combination."
        ]
      },
      layers: { notes: ["JSON retains groups, visibility and locks; drawing exports exclude hidden content and flatten applicable structure.", "locked prevents accidental manual editing only; AI tools can still edit/delete/export locked layers."] },
      defaults: { notes: ["Add defaults depend on current library presets; pass explicit size/color/opacity for predictable results.", "Shapes default to opacity 0.85; textbox/image/prefab to 1. Images default to stretch only when supported; nonzero slice axes use width 136 / height 96, otherwise native size or 96 if metadata is missing."] },
      toolAvailability: { webmcpTextExports: ["json", "css", "svg", "lua"], notes: ["PNG is available through get_canvas_preview; GIA/container-node through the UI or HTTP API, not export_scene.", "Read-only queries share the editor readiness/session boundary; this report does not validate an actual scene or asset. Use get_scene, get_asset_info and get_prefab_info for current details."] },
      evidence: { basis: "current-editor-and-export-source-contract", deviceCompatibility: "not-asserted", notes: ["Resource metadata, export warnings/errors and actual device tests remain authoritative for their respective scopes."] }
    },
    elements: Object.fromEntries(selected.map(value => [value, capability(value)])) as Record<string, ElementCapability>
  });
}
