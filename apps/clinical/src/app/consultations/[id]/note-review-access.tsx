import React, { type ReactNode } from "react";

// This is a presentation boundary. The review RPC independently checks ownership.
export function NoteReviewAccess({ canReviewNote, children, actions, messageClassName }: {
  canReviewNote: boolean;
  children?: ReactNode;
  actions: ReactNode;
  messageClassName?: string;
}) {
  return <>
    {!canReviewNote && <div className={messageClassName} role="status">
      <strong>Read-only note</strong>
      <span>This consultation is assigned to another doctor. Only the assigned doctor can edit, save, reject, or approve this note.</span>
    </div>}
    <fieldset disabled={!canReviewNote} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }} aria-label="Consultation note">
      {children}
    </fieldset>
    {canReviewNote && actions}
  </>;
}
