import React, { useEffect, useRef } from 'react';

export default function FullscreenSearchDialog({
  open,
  onClose,
  eyebrow,
  title,
  description,
  children,
}) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const dialogElement = dialogRef.current;
    if (!dialogElement) return;

    if (open && !dialogElement.open) {
      dialogElement.showModal();
      return;
    }

    if (!open && dialogElement.open) {
      dialogElement.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="jobs-formations-dialog"
      aria-labelledby="jobs-formations-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose?.();
      }}
      onClose={() => {
        if (open) onClose?.();
      }}
    >
      <div className="jobs-formations-dialog-shell">
        <header className="jobs-formations-dialog-header">
          <div>
            {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
            <h2 id="jobs-formations-dialog-title">{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>

          <button
            type="button"
            className="jobs-formations-dialog-close"
            onClick={() => onClose?.()}
            aria-label="Fermer la recherche"
          >
            <span aria-hidden="true">×</span>
            <span>Fermer</span>
          </button>
        </header>

        <div className="jobs-formations-dialog-body">
          {children}
        </div>
      </div>
    </dialog>
  );
}
