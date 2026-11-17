import { useEffect, useRef } from "react";

/** 通用确认弹窗。 */
export function ConfirmDialog({ title, hint, confirmLabel, cancelLabel, onConfirm, onCancel }: {
  title: string;
  hint: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
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
      <h2>{title}</h2>
      <p className="dialog-hint">{hint}</p>
      <div className="prompt-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>{cancelLabel}</button>
        <button type="button" className="btn btn-primary" onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </dialog>
  );
}
