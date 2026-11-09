# Verification — 8 November 2026

Executed on Windows with Node 26.13.0 and npm 11.20.0:

- `npm run lint`: passed without warnings.
- `npm run typecheck`: passed for API and web.
- `npm test`: **11 tests passed** (7 API/scheduling/seed, 4 Vue component tests).
- `npm run build`: passed for API and web.
- Dependency installation's final npm audit: **0 vulnerabilities** after patched Vitest, glob and minimatch updates.
- Browser inspection: login page renders, and its registration link opens the registration form.

The integration suite launches a real isolated MongoDB replica set. It exercises validation, CSRF rejection, login/logout, invitations and revocation, household isolation, concurrent idempotent generation, inactive and one-time chores, assignee-only completion, concurrent double completion, stable snapshots, insufficient balance, concurrent duplicate redemption, and repeatable seeding with working demo credentials. Scheduling tests cover deterministic allocation, empty membership, local week boundaries and daylight saving transitions. Vue tests cover personal/team filtering, assignee controls, insufficient-balance buttons, chore dialog behavior and accessible progress values.

Initial MongoDB startup failed because the Windows Visual C++ runtime was absent. Microsoft's signed x64 runtime was installed successfully (exit code 0); the complete suite then passed. No restart was performed.

Docker was unavailable, so `docker compose up` was **not** executed here. The persistent local database has not been seeded; seed verification used the disposable test database. Full authenticated browser journeys, mobile device checks and a formal accessibility audit have not been performed. The temporary frontend preview was stopped after verification.
