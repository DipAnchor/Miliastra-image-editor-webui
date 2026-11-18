import { useI18n } from "./i18n";
import type { LayerMenuOption } from "./LayerContextMenu";

/** 分组右键菜单：解组/删除置顶；层级；可见性(显示隐藏、只显示本组)；不透明度；导出。 */
export function GroupContextMenu({
  x, y, title, visible, soloActive, opacity, options, selectionCount = 1, onCreateGroup, onConvertToObject, onMove, onToggleVisible, onSolo, onOpacity, onUngroup, onDelete, onExport, onClose, locked = false, onToggleLock, onLockOthers, onRestore, hasLockedOthers = false
}: {
  x: number;
  y: number;
  title: string;
  visible: boolean;
  soloActive: boolean;
  opacity: number;
  options: LayerMenuOption[];
  selectionCount?: number;
  onCreateGroup?: () => void;
  onConvertToObject?: () => void;
  onMove: (direction: "top" | "up" | "down" | "bottom") => void;
  onToggleVisible: () => void;
  onSolo: () => void;
  onOpacity: (value: number) => void;
  onUngroup: () => void;
  onDelete: () => void;
  /** 组是否锁定（决定「锁定/解锁」按钮文案） */
  locked?: boolean;
  onToggleLock: () => void;
  /** 场景中是否存在已锁定图层/组（决定「锁定其他/恢复」按钮文案） */
  hasLockedOthers?: boolean;
  onLockOthers: () => void;
  onRestore: () => void;
  onExport: (key: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const run = (action: () => void) => { action(); onClose(); };
  const percent = Math.round(opacity * 100);
  return (
    <>
      <div className="layer-menu-overlay" data-testid="group-menu-overlay"
        style={{ position: "fixed", inset: 0, zIndex: 9998, background: "transparent" }}
        onClick={onClose} onContextMenu={(event) => { event.preventDefault(); onClose(); }} />
      <div className="quick-edit-menu layer-context-menu"
        style={{ left: Math.min(x + 12, window.innerWidth - 260), top: Math.min(y + 12, window.innerHeight - 500), zIndex: 10000 }}
        onClick={(event) => event.stopPropagation()}>
        <div className="section-head"><span>{t("layer.groupMenu")}</span><em>{selectionCount > 1 ? `${title} · ${selectionCount}` : title}</em></div>
        <div className="layer-menu-row">
          {onCreateGroup ? <button type="button" className="layer-chip" onClick={() => run(onCreateGroup)}>{t("layer.group")}</button> : null}
          {onConvertToObject ? <button type="button" className="layer-chip" onClick={() => run(onConvertToObject)}>{t("smartObject.convert")}</button> : null}
          <button className="layer-chip" onClick={() => run(onUngroup)}>{t("layer.ungroup")}</button>
          <button className="layer-chip" onClick={() => run(onDelete)}>{t("layer.deleteGroup")}</button>
        </div>
        <span className="layer-menu-label">{t("layer.level")}</span>
        <div className="layer-menu-row">
          <button className="layer-chip" onClick={() => run(() => onMove("top"))}>{t("props.layerTop")}</button>
          <button className="layer-chip" onClick={() => run(() => onMove("up"))}>{t("props.layerUp")}</button>
          <button className="layer-chip" onClick={() => run(() => onMove("down"))}>{t("props.layerDown")}</button>
          <button className="layer-chip" onClick={() => run(() => onMove("bottom"))}>{t("props.layerBottom")}</button>
        </div>
        <span className="layer-menu-label">{t("layer.visibility")}</span>
        <div className="layer-menu-row">
          <button className="layer-chip" onClick={() => run(onToggleVisible)}>{visible ? t("layer.hide") : t("layer.show")}</button>
          <button className="layer-chip" onClick={() => run(onSolo)}>{soloActive ? t("layer.soloOffBtn") : t("layer.soloGroup")}</button>
        </div>
        <span className="layer-menu-label">{t("layer.opacity")}</span>
        <div className="layer-menu-row">
          {[100, 75, 50, 25, 0].map((value) => (
            <button key={value} className={`layer-chip${percent === value ? " is-active" : ""}`} onClick={() => run(() => onOpacity(value / 100))}>{value}%</button>
          ))}
        </div>
        <span className="layer-menu-label">{t("layer.lock")}</span>
        <div className="layer-menu-row">
          <button className="layer-chip" onClick={() => run(onToggleLock)}>{locked ? t("layer.unlock") : t("layer.lock")}</button>
          <button className="layer-chip" onClick={() => run(hasLockedOthers ? onRestore : onLockOthers)}>{hasLockedOthers ? t("layer.restore") : t("layer.lockOthers")}</button>
        </div>
        <span className="layer-menu-label">{t("layer.export")}</span>
        <div className="layer-menu-row">
          {options.map((option) => (
            <button key={option.key} className="layer-chip" onClick={() => run(() => onExport(option.key))}>{option.label}</button>
          ))}
        </div>
      </div>
    </>
  );
}
