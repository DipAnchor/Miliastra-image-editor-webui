import { useEffect, useRef } from "react";
import { useI18n } from "./i18n";

/** 导入到画布时选择「覆盖 / 追加」。 */
export function ImportModeDialog({ onChoose, onCancel }: {
  onChoose: (mode: "replace" | "append") => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog ref={dialogRef} className="prompt-dialog"
      onCancel={(event) => { event.preventDefault(); onCancel(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <h2>{t("import.modeTitle")}</h2>
      <p className="dialog-hint">{t("import.modeHint")}</p>
      <div className="prompt-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>{t("import.cancel")}</button>
        <button type="button" className="btn btn-ghost" onClick={() => onChoose("append")}>{t("import.modeAppend")}</button>
        <button type="button" className="btn btn-primary" onClick={() => onChoose("replace")}>{t("import.modeReplace")}</button>
      </div>
    </dialog>
  );
}
