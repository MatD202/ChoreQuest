# HTTP API

Base: `/api/v1`. Responses are JSON. Errors are `{ "error": { "message": "...", "details": [] } }` (`details` for validation only). 400 invalid input, 401 unauthenticated, 403 forbidden/CSRF, 404 absent or inaccessible resource, 409 conflict/insufficient coins, 429 rate limited.

Send credentials on every authenticated request. Every mutation, including login/register, requires `Origin: http://localhost:5173` and `X-ChoreQuest: 1`. Use your configured `WEB_ORIGIN` in deployment. Tokens are set and read using cookies, never localStorage.

```js
const response = await fetch("/api/v1/auth/register", {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json", "X-ChoreQuest": "1" },
  body: JSON.stringify({
    name: "Alex",
    email: "alex@example.com",
    password: "Choose-a-long-password",
  }),
});
// 201 { id, name, email }; browser supplies Origin and stores HTTP-only cookie.
```

| Method       | Route                                              | Body / response                                                |
| ------------ | -------------------------------------------------- | -------------------------------------------------------------- |
| POST         | `/auth/register`                                   | `{name,email,password}` → public user                          |
| POST         | `/auth/login`                                      | `{email,password}` → public user                               |
| POST         | `/auth/logout`                                     | clears session cookie                                          |
| GET          | `/auth/me`                                         | public user with `_id`                                         |
| GET / POST   | `/households`                                      | list memberships / create `{name,timezone}`                    |
| POST         | `/households/join`                                 | `{code}` → `{_id}`                                             |
| POST         | `/households/:id/invite`                           | `{}` rotates, `{revoke:true}` revokes → `{code}`               |
| GET          | `/households/:id/members`                          | membership stats with names, userId, level                     |
| GET / POST   | `/households/:id/chores`                           | list / create chore                                            |
| PUT / DELETE | `/households/:id/chores/:choreId`                  | full update / archive                                          |
| GET          | `/households/:id/assignments?week=2026-11-02`      | week’s snapshots                                               |
| POST         | `/households/:id/assignments/generate`             | `{week:"2026-11-02"}` → `{created,week}`                       |
| PATCH        | `/households/:id/assignments/:assignmentId`        | `{assigneeId}`; pending only                                   |
| POST         | `/assignments/:id/complete`                        | `{}` → `{ok:true}`; assignee only                              |
| GET / POST   | `/households/:id/rewards`                          | list / create reward                                           |
| PUT / DELETE | `/households/:id/rewards/:rewardId`                | full update / archive                                          |
| POST         | `/rewards/:id/redeem`                              | `{}`, UUID `Idempotency-Key` header → ledger entry             |
| GET          | `/households/:id/dashboard?week=2026-11-02&page=1` | membership, level, assignments, achievements, ledger, progress |

Example chore input:

```json
{
  "title": "Water plants",
  "description": "Check soil first",
  "effort": 10,
  "xp": 20,
  "coins": 10,
  "recurrence": "weekly",
  "preferredDay": 3,
  "active": true
}
```

Effort 1–100; XP and coins 0–1000. `recurrence`: `once`, `daily`, `weekly`. `preferredDay` 1–7 (Monday–Sunday), defaults to Monday; ignored for daily chores. Reward input: `{ "title": "Movie pick", "description": "Choose tonight’s movie", "cost": 50, "active": true }`, cost 1–100000.

Example dashboard shape:

```json
{
  "week": "2026-11-02",
  "membership": { "xp": 40, "coins": 30, "completions": 1 },
  "level": 1,
  "assignments": [],
  "achievements": [],
  "ledger": [],
  "progress": { "completed": 1, "total": 8 }
}
```

Resource objects also carry MongoDB `_id` and timestamps. Assignment responses include copied `title`, `description`, `effort`, `xp`, `coins`, plus `assigneeId`, `dueAt` (UTC ISO timestamp), `week` (household local Monday), `status` and optional `completedAt`.
