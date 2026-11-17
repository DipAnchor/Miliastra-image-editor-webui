import { useEffect, useRef, type ChangeEvent } from "react";
import { useI18n } from "./i18n";

export function ImportDialog({ sourceContent, onSourceChange, warnings, onUpload, onImport, onSample, onClose }: {
  sourceContent: string;
  onSourceChange: (value: string) => void;
  warnings: string[];
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onImport: () => void;
  onSample: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog ref={dialogRef} className="prompt-dialog import-dialog"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <h2>{t("tab.import")}</h2>
      <div className="import-dialog-body">
        <div className="tip-box">{t("import.tip")}</div>
        <a className="resource-link" href="https://qx-img.070077.xyz/" target="_blank" rel="noreferrer">
          <em className="import-resource-icon" aria-hidden="true">▧</em>
          <span><strong>{t("tools.fitting")}</strong><small>{t("tools.fittingHint")}</small></span>
          <span aria-hidden="true">↗</span>
        </a>
        <div className="field-hint">{t("import.autoDetect")}</div>
        <label className="upload-box">
          <input type="file" accept=".css,.json,.svg,.lua,text/css,application/json,image/svg+xml,text/plain" onChange={onUpload} />
          <span className="import-upload-icon" aria-hidden="true">⇪</span>
          <strong>{t("import.upload")}</strong>
          <span>.svg / .css / .json / .lua</span>
        </label>
        <label className="field field-grow">
          <span>{t("import.paste")}</span>
          <textarea value={sourceContent} onChange={(event) => onSourceChange(event.target.value)} placeholder={t("import.pastePlaceholder")} />
        </label>
        {warnings.length > 0 ? (
          <div className="message-box warning">
            {warnings.map((warning) => (<p key={warning}>{warning}</p>))}
          </div>
        ) : null}
        <button className="btn btn-ghost" onClick={onSample}>
          <span>{t("import.sample")}</span>
        </button>
      </div>
      <div className="prompt-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>{t("archive.cancel")}</button>
        <button type="button" className="btn btn-primary" onClick={onImport}>{t("import.submit")}</button>
      </div>
    </dialog>
  );
}
