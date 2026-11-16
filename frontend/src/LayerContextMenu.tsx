import { useI18n } from "./i18n";

export type LayerMenuOption = { key: string; label: string };

/** 图层右键菜单（编组置顶；chip 密排；支持多选批量；改名走行内编辑按钮）。 */
export function LayerContextMenu({
  x, y, title, soloActive, options, selectionCount = 1, onCreateGroup, onMove, onToggleVisible, onSolo, onExport, onClose
}: {
  x: number;
  y: number;
  title: string;
  soloActive: boolean;
  options: LayerMenuOption[];
  selectionCount?: number;
  onCreateGroup?: () => void;
  onMove: (direction: "top" | "up" | "down" | "bottom") => void;
  onToggleVisible: () => void;
  onSolo: () => void;
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
        <span className="layer-menu-label">{t("layer.level")}</span>
        <div className="layer-menu-row">
          <button className="layer-chip" onClick={() => run(() => onMove("top"))}>{t("props.layerTop")}</button>
          <button className="layer-chip" onClick={() => run(() => onMove("up"))}>{t("props.layerUp")}</button>
          <button className="layer-chip" onClick={() => run(() => onMove("down"))}>{t("props.layerDown")}</button>
          <button className="layer-chip" onClick={() => run(() => onMove("bottom"))}>{t("props.layerBottom")}</button>
        </div>
        <span className="layer-menu-label">{t("layer.visibility")}</span>
        <div className="layer-menu-row">
          <button className="layer-chip" onClick={() => run(onToggleVisible)}>{t("layer.toggle")}</button>
          {single ? <button className="layer-chip" onClick={() => run(onSolo)}>{soloActive ? t("layer.soloOffBtn") : t("layer.solo")}</button> : null}
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
