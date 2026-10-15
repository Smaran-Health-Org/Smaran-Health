# Independent browser continuation

No source or security/network setting changed in this continuation. User-facing session on smaran-auth-qa.localhost was not signed out or reused for doctor login. Separate background test hostname smaran-final-qa.localhost:56731 served the same loopback-only source snapshot. Synthetic doctor sign-in completed and the real Doctor Today page loaded, confirming Clinical / Synthetic Browser QA Clinic, 2 visits, 2 waiting, 1 human-marked priority and 0 completed.

Native Chrome was inspected for actual 200% zoom. The target was the Smaran AI profile window; only the separate QA tab was selected as the intended target. The input operation stopped with a user-activity guard; subsequent read showed the active user ChatGPT page. No zoom action, personal-window operation or permission change followed. Actual 200% zoom remains unverified.

The independent browser attachment then failed. A fresh test tab was created, but navigation and binding recovery timed out and reset the browser REPL. These attempts do not prove long-field Preview, exception 0/1 interactions or doctor approval/history. They remain pending, along with explicitly blocked document upload and physical-device checks. No workaround for the denied upload was attempted.

Read-only local health diagnosis returned HTTP 200 from task Auth (127.0.0.1:56521/auth/v1/health) and preview login (127.0.0.1:56731/login). Preview remains running as PID 92392. No new build/test run was needed because the already-passing source is unchanged; all eight source SHA256 values still match the isolated preview and saved source-manifest.

Next supported continuation: open a new test tab on smaran-final-qa.localhost, check the existing synthetic doctor session, use qa/responsive count=0 and count=1, inspect the saved stress-patient fixture, then run the actual manual-note save/approval/reopen journey. Do not operate the user's retained preview tab. Finish native zoom only when the separate test window can be controlled without interrupting user activity. No Chrome file-URL permission, phone gateway, trust certificate, firewall or tunnel changes are authorized.
