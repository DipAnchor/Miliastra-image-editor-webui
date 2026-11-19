import { useI18n } from "./i18n";

type LayerDirection = "top" | "up" | "down" | "bottom";

export function SelectionLayerActions({ compact = false, locked, hasLockedOthers, visible = true, onGroup, onMove, onToggleLock, onLockOthers, onRestore, onToggleVisible, onDone }: {
  compact?: boolean;
  locked: boolean;
  hasLockedOthers: boolean;
  visible?: boolean;
  onGroup: () => void;
  onMove: (direction: LayerDirection) => void;
  onToggleLock: () => void;
  onLockOthers: () => void;
  onRestore: () => void;
  onToggleVisible?: () => void;
  onDone?: () => void;
}) {
  const { t } = useI18n();
  const rowClass = compact ? "layer-menu-row" : "selection-actions";
  const buttonClass = compact ? "layer-chip" : "btn btn-ghost";
  const run = (action: () => void) => { action(); onDone?.(); };
  return (
    <div className="selection-layer-actions">
      <div className="section-head"><span>{t("layer.menu")}</span></div>
      <div className={rowClass}>
        <button type="button" className={buttonClass} onClick={() => run(onGroup)}>{t("layer.group")}</button>
      </div>
      <div className={rowClass}>
        {(["top", "up", "down", "bottom"] as const).map(direction => (
          <button type="button" key={direction} className={buttonClass} onClick={() => run(() => onMove(direction))}>{t(`selection.${direction}`)}</button>
        ))}
      </div>
      <div className="section-head"><span>{t("layer.lock")}</span></div>
      <div className={rowClass}>
        <button type="button" className={buttonClass} onClick={() => run(onToggleLock)}>{t(locked ? "layer.unlock" : "layer.lock")}</button>
        <button type="button" className={buttonClass} onClick={() => run(hasLockedOthers ? onRestore : onLockOthers)}>{t(hasLockedOthers ? "layer.restore" : "layer.lockOthers")}</button>
      </div>
      {onToggleVisible ? <>
        <div className="section-head"><span>{t("layer.visibility")}</span></div>
        <div className={rowClass}>
          <button type="button" className={buttonClass} onClick={() => run(onToggleVisible)}>{t(visible ? "layer.hide" : "layer.show")}</button>
        </div>
      </> : null}
    </div>
  );
}
