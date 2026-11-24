import type { SpriteMeta } from "./imageLibrary";
import { resolveImageType } from "./imageStretch";
import { luaMaskActive } from "./luaMask";
import { isSmartObject, releaseObject, validateSmartObject } from "./smartObjects";
import type { SmartObjectDocument } from "./smartObjectModel";

/** Resolve defaults on a private snapshot; the original object is never rewritten. */
export async function releaseObjectWithAssets(document: SmartObjectDocument, objectId: string,
  loadMeta: (imageId: number) => Promise<SpriteMeta | null>) {
  const source = document.elements.find(element => element.id === objectId);
  if (!source || !isSmartObject(source)) throw new Error("smart object not found");
  validateSmartObject(source);
  if (source.scale === 1) return releaseObject(document, objectId);
  const object = structuredClone(source);
  const requests = new Map<number, Promise<SpriteMeta>>();
  const metadata = (id: number) => {
    let request = requests.get(id);
    if (!request) {
      request = loadMeta(id).then(meta => {
        if (!meta) throw new Error("素材 " + id + " 的类型信息不可用；未解除智能对象");
        return meta;
      });
      requests.set(id, request);
    }
    return request;
  };
  await Promise.all(object.content.elements.map(async element => {
    try {
      if (element.type === "image" && element.imageType == null) {
        if (!element.imageAssetId) throw new Error("图片缺少素材编号");
        element.imageType = resolveImageType(await metadata(element.imageAssetId));
      }
      if (luaMaskActive(element.luaMask) && element.luaMask?.imageType == null) {
        const mask = element.luaMask!;
        const id = mask.imageId ?? 100001;
        element.luaMask = { ...mask, imageType: resolveImageType(await metadata(id))! };
      }
    } catch (error) {
      throw new Error("图层“" + (element.layerName || element.name || element.id) + "” (" + element.id + ")：" + (error instanceof Error ? error.message : String(error)));
    }
  }));
  return releaseObject({ ...document, elements: document.elements.map(element => element.id === objectId ? object : element) }, objectId);
}
