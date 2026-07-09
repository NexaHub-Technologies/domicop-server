# DOMICOP Auth API Contract (Mobile & Admin Clients)

The contract clients build against for the `/auth` route after the
**email/password-only migration** (July 2026). Shapes are taken from the route
handlers in `src/routes/v1/auth.ts`, not aspirational.

Authentication is now **email + password only**. Google Sign-In and email
verification have been removed — see §2 for the full list of breaking changes
and what clients must do about them.

---

## 1. Conventions

| Aspect | Value |
| --- | --- |
| Base URL | `https://<api-host>/v1` (legacy unversioned `/auth/*` paths also resolve) |
| Auth | `Authorization: Bearer <supabase_access_token>` where marked below |
| Content type | `application/json` |
| Timestamps | ISO-8601 UTC strings |
| IDs | UUID strings |
| Token lifetime | `expires_in` is in **seconds** (3600 = 1 hour) |

### Rate limiting

The entire `/auth` group is limited to **10 requests per minute per IP**.
Exceeding it returns:

```json
// 429
{ "error": "Too many auth attempts. Wait 1 minute." }
```

Clients must back off on 429 — do not auto-retry login/register in a loop.

### Error envelope

All errors return `{ "error": string }` with an appropriate status.
Validation failures additionally include `details`:

```json
// 422 Unprocessable Entity
{ "error": "Validation failed", "details": "<which field and why>" }
```

| Status | Meaning |
| --- | --- |
| 400 | Request rejected by Supabase Auth (e.g. email already registered, weak password) |
| 401 | Invalid credentials, or missing/invalid/expired token on authenticated routes |
| 404 | Route not found — **this is what the removed Google/verification endpoints now return** |
| 422 | Body failed schema validation |
| 429 | Auth rate limit exceeded |
| 500 | Unhandled server error |

### User object

Returned by `POST /auth/login`:

```ts
type AuthUser = {
  id: string;              // UUID
  email: string;
  role: "admin" | "member"; // admin iff the user has an admin_profiles row
  email_verified: boolean;  // informational only — never blocks login
};
```

---

## 2. Breaking changes in this revision

Clients built against the previous contract **must** remove the following
integrations. All removed endpoints now return
`404 { "error": "Route not found" }`.

| Change | Was | Now |
| --- | --- | --- |
| `POST /auth/oauth/google` | Google ID-token login | **Removed** — login is `POST /auth/login` only |
| `POST /auth/link/google` | Link Google identity to account | **Removed** |
| `POST /auth/resend-verification` | Resend confirmation email | **Removed** — no verification emails exist |
| Email verification | Sign-up sent a confirmation email; login could return 403 "verify your email" | **Off** — accounts are auto-confirmed; login never returns the verification 403 |
| Register success `message` | `"Registration successful. Please check your email to verify your account."` | `"Registration successful. Your application is pending admin approval."` |

### Required client migration

1. **Remove the Google Sign-In button and SDK** (e.g.
   `@react-native-google-signin/google-signin`) and any calls to
   `/auth/oauth/google` and `/auth/link/google`.
2. **Remove all "verify your email" UI**: verification-pending screens, the
   "Resend Email" action, and the login error branch matching
   `verify your email` — that error can no longer occur.
3. **After registration, route users to the pending-approval flow**, not an
   email-verification flow. Account activation is by admin approval
   (`profiles.status: "pending" → "active"`), not email confirmation.
4. **Do not key any logic off `email_verified`** in the login response. It is
   informational; with auto-confirm on it is `true` for new accounts, but
   pre-migration accounts may vary.
5. **Users who only ever signed in with Google have no password.** They must
   use `POST /auth/reset-password` to set one before they can log in again.
   Consider a "Can't log in? Reset your password" affordance on the login
   screen during the transition.

---

## 3. `POST /auth/login` — email/password login

Public. The only way to obtain a session.

```json
// request
{ "email": "user@example.com", "password": "password123" }
```

| Field | Type | Required | Constraint |
| --- | --- | --- | --- |
| `email` | string | yes | valid email |
| `password` | string | yes | min 8 chars |

```json
// 200
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "xxx",
  "expires_in": 3600,
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "role": "member",
    "email_verified": true
  }
}
```

### Failure statuses

| Status | Body | Meaning |
| --- | --- | --- |
| 401 | `{ "error": "Invalid login credentials" }` | wrong email/password (message comes from Supabase) |
| 422 | `{ "error": "Validation failed", "details": "…" }` | malformed email or password < 8 chars |

Login does **not** check approval status — a `pending` member can log in but
other endpoints gate on `profiles.status`. Route pending users to the
pending-approval screen after login.

---

## 4. `POST /auth/register` — create account

Public. Creates the auth user and all profile fields in one call. The profile
row is auto-created by a database trigger; admins are notified of the new
pending application. **No email is sent.**

```json
// request
{
  "email": "newuser@example.com",
  "password": "password123",
  "full_name": "John Doe",
  "phone": "+2348012345678",
  "address": "123 Main Street, City",
  "bank_name": "First National Bank",
  "bank_account": "1234567890",
  "bank_code": "058",
  "avatar_url": "https://example.com/avatars/user.jpg",
  "next_of_kin": "Jane Doe - +2348098765432"
}
```

| Field | Type | Required | Constraint |
| --- | --- | --- | --- |
| `email` | string | yes | valid email |
| `password` | string | yes | min 8 chars |
| `full_name` | string | yes | min 2 chars |
| `phone` | string | yes | — |
| `address` | string | yes | — |
| `bank_name` | string | yes | — |
| `bank_account` | string | yes | — |
| `bank_code` | string | yes | — |
| `avatar_url` | string | no | — |
| `next_of_kin` | string | no | — |

```json
// 200
{
  "message": "Registration successful. Your application is pending admin approval.",
  "user_id": "uuid",
  "email": "newuser@example.com"
}
```

### Post-registration flow

Registration does **not** return a session. The intended flow:

1. Register → show the pending-approval message.
2. The user may log in immediately (`POST /auth/login`) — no email
   verification step exists.
3. Full access begins once an admin approves the application
   (`profiles.status` becomes `active`).

### Failure statuses

| Status | Body | Meaning |
| --- | --- | --- |
| 400 | `{ "error": "…" }` | Supabase rejection — e.g. `"User already registered"` |
| 422 | `{ "error": "Validation failed", "details": "…" }` | missing/invalid fields |

---

## 5. `POST /auth/refresh` — refresh session

Public. Exchange a refresh token for new tokens. Refresh-token rotation is
enabled: the old refresh token is invalidated — **always store the new pair**.

```json
// request
{ "refresh_token": "xxx" }
```

```json
// 200
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "yyy",
  "expires_in": 3600
}
```

| Status | Body | Meaning |
| --- | --- | --- |
| 401 | `{ "error": "…" }` | refresh token invalid, expired, or already rotated → force re-login |

---

## 6. `POST /auth/logout` — end session

**Requires Bearer token.** Invalidates the session server-side. Clients must
also clear stored tokens regardless of the response.

```json
// 200
{ "success": true }
```

---

## 7. `POST /auth/reset-password` — request password reset

Public. Sends a password-reset email. Always returns 200 to prevent email
enumeration.

```json
// request
{ "email": "user@example.com" }
```

```json
// 200 — same body whether or not the email exists
{ "message": "If that email is registered, a reset link has been sent." }
```

This is the **only** email the auth flow ever sends, and the recovery path for
former Google-only users (§2.5).

---

## 8. `POST /auth/confirm-reset` — set new password

Public path, but requires the **recovery token from the reset email** as the
Bearer token.

```
POST /v1/auth/confirm-reset
Authorization: Bearer <recovery-token-from-email-link>
```

```json
// request
{ "password": "newpassword123" }
```

| Field | Type | Required | Constraint |
| --- | --- | --- | --- |
| `password` | string | yes | min 8 chars |

```json
// 200
{ "success": true }
```

| Status | Body | Meaning |
| --- | --- | --- |
| 400 | `{ "error": "…" }` | recovery token invalid/expired, or password rejected |

---

## 9. `POST /auth/change-password` — change password

**Requires Bearer token.** Verifies the current password before updating.

```json
// request
{ "current_password": "oldpassword123", "new_password": "newpassword123" }
```

| Field | Type | Required | Constraint |
| --- | --- | --- | --- |
| `current_password` | string | yes | min 8 chars |
| `new_password` | string | yes | min 8 chars |

```json
// 200
{ "success": true, "message": "Password changed successfully" }
```

| Status | Body | Meaning |
| --- | --- | --- |
| 401 | `{ "error": "Current password is incorrect" }` | verification failed |
| 400 | `{ "error": "…" }` | new password rejected by Supabase |

Note: verifying the current password counts as a login attempt against the
10/min auth rate limit.

---

## 10. `POST /auth/expo-token` — store push token (legacy)

**Requires Bearer token.** Stores the Expo push token. This endpoint is
**legacy** — new builds should use `POST /notifications/devices` instead (see
`NOTIFICATION_SYSTEM.md`).

```json
// request
{ "expo_push_token": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]" }
```

```json
// 200
{ "success": true }
```

---

## 11. Quick reference

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/auth/login` | public | Email/password login → tokens + user |
| POST | `/auth/register` | public | Create account (no session, no email) |
| POST | `/auth/refresh` | public | Rotate tokens |
| POST | `/auth/logout` | Bearer | Invalidate session |
| POST | `/auth/reset-password` | public | Send reset email (always 200) |
| POST | `/auth/confirm-reset` | recovery token | Set new password |
| POST | `/auth/change-password` | Bearer | Change password (verifies current) |
| POST | `/auth/expo-token` | Bearer | Store push token (legacy) |

Removed (now 404): `POST /auth/oauth/google`, `POST /auth/link/google`,
`POST /auth/resend-verification`.

---

## 12. Notes for implementers

- **One login path.** There is no OAuth of any kind. If the app still shows a
  Google button, it is calling a dead endpoint.
- **No verification emails.** The only email the system sends from auth is the
  password-reset email. Do not build UI that waits for a confirmation email.
- **Registration ≠ access.** New accounts are `pending` until admin approval.
  Design the post-register and post-login flows around `profiles.status`, not
  `email_verified`.
- **Rotation means single-use refresh tokens.** After `/auth/refresh`, the old
  refresh token is dead (with a 10s reuse grace window). Persist the new pair
  atomically; a stale stored token forces re-login.
- **Rate limit is per IP across all `/auth` endpoints combined** — login,
  register, refresh, and change-password share the 10/min budget.
- **Former Google-only accounts** keep their user ID, profile, and data. They
  regain access via the reset-password flow; nothing needs re-registering.
