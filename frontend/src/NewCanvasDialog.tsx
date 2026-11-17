import { useEffect, useRef } from "react";
import { useI18n } from "./i18n";

/** 新建画布前，如果当前画布已有内容则弹确认框。 */
export function NewCanvasDialog({ onConfirm, onCancel }: {
  onConfirm: () => void;
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
      <h2>{t("newCanvas.title")}</h2>
      <p className="dialog-hint">{t("newCanvas.hint")}</p>
      <div className="prompt-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>{t("newCanvas.cancel")}</button>
        <button type="button" className="btn btn-primary" onClick={onConfirm}>{t("newCanvas.confirm")}</button>
      </div>
    </dialog>
  );
}
