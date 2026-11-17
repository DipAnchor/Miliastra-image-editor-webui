import { useEffect, useRef, useState } from "react";
import { useI18n } from "./i18n";

/** 存档设置：最多保留数量、启动时是否恢复上次编辑。 */
export function ArchiveSettingsDialog({ initialMax, initialRestore, onSave, onCancel }: {
  initialMax: number;
  initialRestore: boolean;
  onSave: (max: number, restore: boolean) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(String(initialMax));
  const [restore, setRestore] = useState(initialRestore);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog ref={dialogRef} className="prompt-dialog"
      onCancel={(event) => { event.preventDefault(); onCancel(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <h2>{t("archive.settingsTitle")}</h2>
      <p className="dialog-hint">{t("archive.settingsHint")}</p>
      <label className="archive-setting-row">
        <span>{t("archive.settingsMax")}</span>
        <input className="archive-max-input" type="number" min="1" max="50" value={value}
          onChange={(event) => setValue(event.target.value)} />
      </label>
      <label className="check-row" style={{ marginTop: 12 }}>
        <input type="checkbox" checked={restore} onChange={(event) => setRestore(event.target.checked)} />
        <span>{t("archive.autoRestore")}</span>
      </label>
      <div className="prompt-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>{t("archive.cancel")}</button>
        <button type="button" className="btn btn-primary"
          onClick={() => onSave(Math.max(1, Math.min(50, Number(value) || 20)), restore)}>{t("archive.save")}</button>
      </div>
    </dialog>
  );
}
