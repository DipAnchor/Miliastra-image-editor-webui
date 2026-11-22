# Miliastra Image Editor

[中文](README.zh-CN.md) · **English** · [Open editor](https://qx.070077.xyz/)

Build artwork and UI for Miliastra Wonderland in your browser. Combine shapes, game image assets and editable text, then export a GIA file or a client Lua drawing script. You can edit by hand or ask a WebMCP-capable AI client to work on the same canvas.

## Project origin and this fork

This repository is a downstream fork of [Miliastra-image-editor-webui](https://github.com/1475505/Miliastra-image-editor-webui). Upstream provides browser-based UI composition for Miliastra Wonderland with GIA and Lua export; this branch keeps those export formats and workflows and continues development on top of them.

The goal is to grow the editor into a **scene editor** closer to Photoshop: layers and groups stay maintainable, and transforms, masks and structure remain editable instead of being composed once and exported. `main` only mirrors upstream; feature work happens on `develop`. See [Fork maintenance and upstream sync](docs/fork.md) for the branch model, sync steps and compatibility rules.

### What differs from upstream

These are the changes on `develop` relative to the upstream mirror `main`, summarised from the commit history:

| Area | Added or changed here |
|---|---|
| Layers and groups | Persistent layer tree, nested groups with drag and drop, group visibility/solo/opacity and search; element visibility, layer names and group membership are saved in the scene |
| Locking | Elements and groups can be locked against canvas selection, dragging and property edits; WebMCP can still change them explicitly |
| Structure | Editable smart objects: a composition becomes one layer without rasterizing its contents and can be re-entered |
| Transform | Center/free scaling, edge handles for single-axis resize, multi-selection scaling and rotation, explicit transform mode with property preview, cursor-centered wheel zoom |
| Masks | Independent mask editing (move, resize, rotate outside the frame, invert area), inversion bounded to the rotated mask rectangle, faster auxiliary preview |
| Workflow | History archives, new canvas, import dialog (replace/append, format detection, appended imports grouped automatically), quick shape library on empty-canvas right-click |
| AI | Built on the upstream WebMCP tool set with an element capability table, lock semantics and atomic layer-group creation |
| Engineering | Vitest component tests; build output and local scripts stay out of the repository |

Drawing exports keep the upstream contract: visibility filtering and group opacity are baked at export time, while JSON keeps the full structure. See [Fork maintenance and upstream sync](docs/fork.md) for details and merge caveats.

## Start creating

1. Open the [editor](https://qx.070077.xyz/). Drag an item from the library onto the canvas, or double-click to add it. Import existing CSS, SVG, JSON or supported Lua from **Import**.
2. Move, resize and rotate elements. Use the properties panel for text, colors, image types and masks, or the Advanced tab to edit a mask on its own. Shift-click or drag on empty space to select several elements.
3. Choose **Export → JSON** to save an editable copy. Choose **GIA** or **Lua** to use the result in the game editor.

**Save & Apply updates the editor and reusable library items; it does not save a file.** Export your work before reloading or closing the page.

## What you can make

- Artwork from rectangles, ellipses, triangles, stars and rings.
- UI compositions using searchable game images, Basic/Stretch rendering, tinting and layers.
- Native textboxes with rich text, font sizing, outline and alignment.
- Editable smart objects: keep a composition as one layer without rasterizing its contents.
- Layers and groups: group, nest, lock, hide or solo layers.
- Lua-only image masks and feathered effects, with an independent mask edit mode for moving, resizing and rotating the mask. A dashed contour and shaded overlay help you edit hidden areas.
- Compositions with Prefab thumbnails found by their exact ID; JSON saving and Lua drawing are supported.

![Blue-to-gold text example](demo/gradient-text-preview.png)

[Try the gradient-text example](demo/gradient-text.md). Need to convert a bitmap to shapes? Use the separate [image fitting tool](https://qx-img.070077.xyz/).

## Smart objects

Right-click an ordinary group or contiguous ordinary layers under the same parent and choose **Convert to Smart Object**. For non-contiguous layers or layers under different parents, group them explicitly first. Move, rotate around Z and uniformly scale the object as one layer; copies have independent contents, not linked instances. Nested smart objects are not supported.

Choose **Edit object contents** to work in a separate local draft. Its read-only frame stays stable while editing and never clips overflowing contents. **Save and keep editing** (`Ctrl/⌘+S`) or **Finish editing** fits changed contents to the geometric bounds of all layers, including hidden and locked ones. Local coordinates and the object position are compensated so fitting preserves the edited artwork’s placement in the main scene, rotation and scale; the object center and outer bounds may change. Empty contents keep the previous frame.

**Save and keep editing** applies changes as one main undo step without leaving and preserves internal undo/redo. An unchanged save neither fits the frame nor adds history. **Finish editing** applies only changes made since the last save and exits. **Discard changes** never reverts already-saved contents. There is no manual frame-size control. **Release to ordinary group** preserves the current parent and appearance when the transform can be represented exactly.

Save JSON to retain editable objects. Drawing formats flatten supported contents; unsupported combinations produce a diagnostic instead of silently changing the artwork. Lua also carries an editor snapshot tied to a drawing digest; changing its drawing records invalidates object restoration and produces an import warning. See the [user guide](docs/README.md#智能对象). Smart-object exports have not been verified in the game.

## Pick an export format

| Format | Best for | Notes |
|---|---|---|
| JSON | Saving and continuing your work | Preserves scene settings and saved library items |
| Lua | Drawing native images and text in a client UI | Requires your control template indices and script attachment |
| GIA | Importing a UI asset group into the game editor | Scenes containing Prefabs or active element masks or feathering require Lua instead |
| Container node GIA | Importing as a client control template with image children | No script needed; textboxes, Prefabs and circular canvas masks are not exported |
| CSS / SVG | Sharing or using the supported artwork subset | SVG omits rings; complex SVG is not a lossless editing format |
| PNG | Rendered image via the API or AI preview tool | Unavailable for Prefabs and active element masks or feathering |

The canvas background is a viewing preference. Add a full-canvas rectangle if the exported artwork needs a solid background. Web mask previews are approximations; check the final result in the game.

## Useful shortcuts

Use `Ctrl` on Windows/Linux or `⌘` on macOS.

- Shift-click: add/remove canvas selections; Shift-click in Layers: select a range.
- Drag empty space: marquee selection. Space-drag or middle-drag: pan the view.
- `Ctrl/⌘+A`, `C`, `X`, `V`, `D`: select all, copy, cut, paste, duplicate.
- Arrow keys: move 1px; Shift+arrow: 10px. Delete removes selected elements.
- `Ctrl/⌘+Z`: undo; `Ctrl/⌘+Shift+Z` or `Ctrl/⌘+Y`: redo.
- Click **Shortcuts** or press `?` for the full list. Text fields and dialogs keep their own keys.

## Use with AI / WebMCP

Open the editor in a browser connected to an AI client that can discover page WebMCP tools. Ask it to list the tools on the current page, then try:

> Make a 600×400 title card with a dark background, three image elements and a centered title. Keep the existing artwork, and export JSON when finished.

Tools cover asset search, previews, batch editing, named layer-group organization, import/export and undo. They edit the open page; this project does not provide a standalone MCP server. If tools are not listed, check that the browser integration exposes `document.modelContext.registerTool`. Ordinary browsers can still use the editor manually.

To organize layers, the AI reads the current element and group ids first, then creates the named groups for one batch, for example "slime → body / horns / eyes". A batch takes one undo step and group names are saved with the JSON artwork; existing visibility and opacity on ancestor groups keep applying and elements are not reordered.

[WebMCP setup and examples](docs/webmcp.md) · [Reusable AI skills](skills/)

## Run locally

Install **Python 3.13** and **Node.js 20+** (with npm), clone the repository, then run:

```powershell
# Windows PowerShell, from the repository root
.\start.bat
```

```bash
# Linux / macOS, from the repository root
bash start.sh
```

The launchers install dependencies, build the frontend and serve the app at **http://localhost:8439**. Docker builds include the frontend:

```bash
docker build -t miliastra-image-editor .
docker run --rm -p 8439:8439 miliastra-image-editor
```

## More help

- [User guide and document index](docs/README.md) (Chinese)
- [Keyboard and mouse operations](docs/editor-interaction.md)
- [Lua export and masks](docs/lua-mask.md)
- [Local development and deployment](docs/deploy.md)
- [Maintenance notes: source layout and compatibility contracts](docs/technical-design.md)
- [Report an issue](https://github.com/1475505/Miliastra-image-editor-webui/issues)

Please follow the game's creator rules and respect others' rights. [License](LICENSE).
