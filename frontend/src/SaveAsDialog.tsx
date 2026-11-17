import { useEffect, useRef, useState } from "react";
import { useI18n } from "./i18n";

/** 另存为：输入新存档名。 */
export function SaveAsDialog({ initialName, onSave, onCancel }: {
  initialName: string;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(initialName);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  const submit = () => onSave(name.trim() || initialName);

  return (
    <dialog ref={dialogRef} className="prompt-dialog"
      onCancel={(event) => { event.preventDefault(); onCancel(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <h2>{t("archive.saveAsTitle")}</h2>
      <p className="dialog-hint">{t("archive.saveAsHint")}</p>
      <input className="archive-max-input" value={name} autoFocus
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") submit(); }} />
      <div className="prompt-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>{t("archive.cancel")}</button>
        <button type="button" className="btn btn-primary" onClick={submit}>{t("archive.saveAsConfirm")}</button>
      </div>
    </dialog>
  );
}
