# Mac preview entry and local test checklist

1. On this Mac, open the retained Chrome tab in the **Smaran AI** profile, or `http://smaran-auth-qa.localhost:56731/desk`. Confirm **Synthetic Browser QA Clinic**. The existing session is the disposable assistant account; no production credentials are needed.
2. Reception: resize to the listed widths, expand/collapse exceptions, reach Expected/Waiting/With doctor/Completed vertically, and open operational patient details. Tab to Mark Priority and press Enter; entering a reason must keep you on Reception. Cancel must preserve queue state.
3. Scheduler: use Schedule, New appointment, patient search, duration validation and Close/Escape. At 1280x720, page scrolling must expose Book; on phones the navigation must hide while the modal is open and return on close. Use existing fictional records only.
4. Doctor checks require switching to the existing synthetic doctor account. Use the locally stored ignored fixture credentials, never the production sign-in. Test compact View schedule, actual full-page Preview, manual save/approval, and approved-only history. These remaining checks are not yet claimed complete.
5. Actual 200% zoom and Safari/device keyboard/safe-area checks remain pending. The loopback URL is Mac-only; phone access needs the separately reviewed HTTPS option.

Current source is synchronized; latest checks are the `followup-*.log` files. Do not enter real patient data. UI document upload is blocked by the extension file-access permission, which remains unchanged.
