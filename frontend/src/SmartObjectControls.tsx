import { useI18n } from "./i18n";
import type { SmartObject } from "./smartObjectModel";

export type SmartObjectInspectorProps = {
  object: SmartObject;
  onChange: (patch: Partial<SmartObject>) => void;
  onEdit: () => void;
  onRelease: () => void;
};

/** Shell-only controls; the read-only content frame fits changed contents on save, not live during editing. */
export function SmartObjectInspector({ object, onChange, onEdit, onRelease }: SmartObjectInspectorProps) {
  const { t } = useI18n();
  const frame = object.content.frame;
  const number = (label: string, value: number, update?: (value: number) => void, min?: number, max?: number) => (
    <label className={"num-field" + (!update ? " smart-object-readonly" : "")}>
      <span>{label}</span>
      <input type="number" step="any" value={value} min={min} max={max} readOnly={!update}
        onChange={update ? event => {
          const next = event.currentTarget.valueAsNumber;
          if (Number.isFinite(next)) update(next);
        } : undefined} />
    </label>
  );
  return <section className="smart-object-inspector stack" aria-label={t("smartObject.title")}>
    <div className="inspector-head">
      <div className="layer-info"><strong>{t("smartObject.title")}</strong>
        <span>{t("smartObject.childCount", { count: object.content.elements.length })}</span></div>
    </div>
    <label className="field"><span>{t("smartObject.name")}</span>
      <input value={object.layerName ?? object.name} onChange={event => onChange({ layerName: event.currentTarget.value })} />
    </label>
    <div className="smart-object-actions">
      <button type="button" className="btn btn-tonal" onClick={onEdit}>{t("smartObject.edit")}</button>
      <button type="button" className="btn btn-ghost" onClick={onRelease}>{t("smartObject.release")}</button>
    </div>
    <div className="section-head"><span>{t("smartObject.frame")}</span></div>
    <div className="grid-2">
      {number(t("smartObject.frameWidth"), frame.width)}
      {number(t("smartObject.frameHeight"), frame.height)}
    </div>
    <p className="field-hint">{t("smartObject.frameHint")}</p>
    <div className="section-head"><span>{t("props.transform")}</span></div>
    <div className="grid-2">
      {number("X", object.x, x => onChange({ x }))}
      {number("Y", object.y, y => onChange({ y }))}
    </div>
    {number(t("smartObject.rotationZ"), object.rotation, rotation => onChange({ rotation }))}
      {number(t("smartObject.scale"), object.scale * 100, percent => {
        const scale = percent / 100;
        if (scale > 0) onChange({ scale });
      }, 0)}
    <div className="section-head"><span>{t("smartObject.size")}</span></div>
    <div className="grid-2">
      {number(t("smartObject.displayWidth"), frame.width * object.scale)}
      {number(t("smartObject.displayHeight"), frame.height * object.scale)}
    </div>
    <p className="field-hint">{t("smartObject.sizeHint")}</p>
    {number(t("smartObject.opacity"), object.opacity * 100,
      percent => onChange({ opacity: Math.min(100, Math.max(0, percent)) / 100 }), 0, 100)}
  </section>;
}

export type ObjectEditorBarProps = {
  name: string;
  dirty: boolean;
  onSave: () => void;
  onFinish: () => void;
  onDiscard: () => void;
  onClose: () => void;
};

/** Session actions are owned by the parent; this bar never commits or discards implicitly. */
export function ObjectEditorBar({ name, dirty, onSave, onFinish, onDiscard, onClose }: ObjectEditorBarProps) {
  const { t } = useI18n();
  return <section className="object-editor-bar" aria-label={t("smartObject.editing")}>
    <div className="object-editor-info">
      <span className="object-editor-label">{t("smartObject.editing")}</span>
      <strong title={name}>{name}</strong>
      <span className={"object-editor-status" + (dirty ? " is-dirty" : "")} role="status">
        {t(dirty ? "smartObject.unsaved" : "smartObject.saved")}
      </span>
    </div>
    <div className="object-editor-actions">
      <button type="button" className="btn btn-ghost" onClick={onClose}>{t("smartObject.close")}</button>
      <button type="button" className="btn btn-danger-ghost" onClick={onDiscard}>{t("smartObject.discard")}</button>
      <button type="button" className="btn btn-tonal" onClick={onSave}>{t("smartObject.save")}</button>
      <button type="button" className="btn btn-primary" onClick={onFinish}>{t("smartObject.finish")}</button>
    </div>
  </section>;
}
