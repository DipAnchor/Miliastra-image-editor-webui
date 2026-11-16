import { useEffect, useRef, useState } from "react";
import { useI18n } from "./i18n";

/** 项目风格的重命名弹窗（元素图元与分组复用）。 */
export function RenameDialog({ initial, titleKey = "layer.renameTitle", labelKey = "layer.nameLabel", onCancel, onConfirm }: {
  initial: string;
  titleKey?: string;
  labelKey?: string;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initial);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    inputRef.current?.focus();
    inputRef.current?.select();
    return () => dialog?.close();
  }, []);

  return (
    <dialog ref={dialogRef} className="prompt-dialog"
      onCancel={(event) => { event.preventDefault(); onCancel(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <form method="dialog" onSubmit={(event) => { event.preventDefault(); onConfirm(value); }}>
        <h2>{t(titleKey)}</h2>
        <label className="field"><span>{t(labelKey)}</span>
          <input ref={inputRef} value={value} onChange={(event) => setValue(event.target.value)} maxLength={80} spellCheck={false} />
        </label>
        <div className="prompt-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>{t("layer.cancel")}</button>
          <button type="submit" className="btn btn-primary">{t("layer.confirm")}</button>
        </div>
      </form>
    </dialog>
  );
}
