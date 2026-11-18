import { useI18n } from "./i18n";

export type LayerMenuOption = { key: string; label: string };

/** 图层右键菜单（编组置顶；chip 密排；支持多选批量；改名走行内编辑按钮）。 */
export function LayerContextMenu({
  x, y, title, visible = true, soloActive, options, selectionCount = 1, onCreateGroup, onConvertToObject, onEditObject, onReleaseObject, onMove, onToggleVisible, onSolo, onExport, onClose, locked = false, onToggleLock, onLockOthers, onRestore, hasLockedOthers = false
}: {
  x: number;
  y: number;
  title: string;
  soloActive: boolean;
  options: LayerMenuOption[];
  /** 当前选中图层是否可见（决定「显示/隐藏图层」按钮文案） */
  visible?: boolean;
  selectionCount?: number;
  onCreateGroup?: () => void;
  onConvertToObject?: () => void;
  onEditObject?: () => void;
  onReleaseObject?: () => void;
  onMove: (direction: "top" | "up" | "down" | "bottom") => void;
  onToggleVisible: () => void;
  onSolo: () => void;
  /** 当前选中是否锁定（决定「锁定/解锁」按钮文案） */
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
  const single = selectionCount <= 1;
  return (
    <>
      <div className="layer-menu-overlay" data-testid="layer-menu-overlay"
        style={{ position: "fixed", inset: 0, zIndex: 9998, background: "transparent" }}
        onClick={onClose} onContextMenu={(event) => { event.preventDefault(); onClose(); }} />
      <div className="quick-edit-menu layer-context-menu"
        style={{ left: Math.min(x + 12, window.innerWidth - 260), top: Math.min(y + 12, window.innerHeight - 440), zIndex: 10000 }}
        onClick={(event) => event.stopPropagation()}>
        <div className="section-head"><span>{t("layer.menu")}</span><em>{selectionCount > 1 ? `${title} · ${selectionCount}` : title}</em></div>
        {onCreateGroup ? (
          <div className="layer-menu-row">
            <button className="layer-chip" onClick={() => run(onCreateGroup)}>{t("layer.group")}</button>
          </div>
        ) : null}
        {onConvertToObject || onEditObject || onReleaseObject ? (
          <>
            <span className="layer-menu-label">{t("smartObject.title")}</span>
            <div className="layer-menu-row">
              {onConvertToObject ? <button type="button" className="layer-chip" onClick={() => run(onConvertToObject)}>{t("smartObject.convert")}</button> : null}
              {onEditObject ? <button type="button" className="layer-chip" onClick={() => run(onEditObject)}>{t("smartObject.edit")}</button> : null}
              {onReleaseObject ? <button type="button" className="layer-chip" onClick={() => run(onReleaseObject)}>{t("smartObject.release")}</button> : null}
            </div>
          </>
        ) : null}
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
          {single ? <button className="layer-chip" onClick={() => run(onSolo)}>{soloActive ? t("layer.soloOffBtn") : t("layer.solo")}</button> : null}
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
