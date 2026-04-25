# API Versioning Guide

How to manage and upgrade API versions on the DOMICOP server.

## Overview

All application routes live under a version prefix. The current setup:

- `src/routes/v1/index.ts` — v1 route aggregator (`/v1`)
- `src/index.ts` — app assembly, registers versioned routes with a single line

```
src/index.ts
  └── .use(v1Routes)          ← single import from @/routes/v1
        ├── /v1/auth/*
        ├── /v1/members/*
        ├── /v1/dashboard/*
        ├── /v1/contributions/*
        ├── /v1/loans/*
        ├── /v1/dividends/*
        ├── /v1/messages/*
        ├── /v1/notifications/*
        ├── /v1/ws/notifications
        ├── /v1/announcements/*
        └── /v1/reports/*
```

Root `/`, `/health`, and `/swagger` are unversioned. Everything else is at `/v1/*`.

---

## Creating a v2 Upgrade

### Step 1: Create the v2 route aggregator

```bash
mkdir -p src/routes/v2
```

**`src/routes/v2/index.ts`**

```typescript
import Elysia from "elysia";

// Reuse unchanged routes from v1 — no copy-paste needed
import { authRoutes } from "@/routes/v1/auth";
import { contributionRoutes } from "@/routes/v1/contributions";
import { loanRoutes } from "@/routes/v1/loans";
import { dividendRoutes } from "@/routes/v1/dividends";
import { messageRoutes } from "@/routes/v1/messages";
import { notificationRoutes } from "@/routes/v1/notifications";
import { websocketRoutes } from "@/routes/v1/websocket";
import { announcementRoutes } from "@/routes/v1/announcements";
import { reportRoutes } from "@/routes/v1/reports";

// Versioned copies of routes with breaking changes
import { dashboardRoutes as v2DashboardRoutes } from "./dashboard";
import { memberRoutes as v2MemberRoutes } from "./members";

export const v2Routes = new Elysia({ prefix: "/v2" })
  .use(authRoutes)              // unchanged
  .use(v2DashboardRoutes)       // response shape changed
  .use(v2MemberRoutes)          // new endpoint added
  .use(contributionRoutes)      // unchanged
  .use(loanRoutes)              // unchanged
  .use(dividendRoutes)          // unchanged
  .use(messageRoutes)           // unchanged
  .use(notificationRoutes)      // unchanged
  .use(websocketRoutes)         // unchanged
  .use(announcementRoutes)      // unchanged
  .use(reportRoutes);           // unchanged
```

### Step 2: Version the routes that changed

Example — dashboard response gained new fields. Create `src/routes/v2/dashboard.ts`:

```typescript
import Elysia from "elysia";
import { authenticate } from "@/middleware/authenticate";
import { supabase } from "@/lib/supabase";

export const dashboardRoutes = new Elysia({ prefix: "/dashboard" })
  .use(authenticate)

  .get("/summary", async ({ userId }) => {
    const currentYear = new Date().getFullYear();
    const currentMonth = `${currentYear}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;

    const [profile, contributions, activeLoan, recentTxns, announcements] =
      await Promise.all([
        supabase
          .from("profiles")
          .select("full_name, member_no, status, avatar_url")
          .eq("id", userId)
          .single(),

        supabase
          .from("contributions")
          .select("amount, payment_status, month")
          .eq("member_id", userId)
          .eq("year", currentYear)
          .eq("payment_status", "success"),

        supabase
          .from("loans")
          .select("id, amount_approved, balance, monthly_repayment, status, due_date")
          .eq("member_id", userId)
          .in("status", ["disbursed", "repaying"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),

        supabase
          .from("transactions")
          .select("id, amount, type, status, created_at, description")
          .eq("member_id", userId)
          .eq("status", "success")
          .order("created_at", { ascending: false })
          .limit(5),

        supabase
          .from("announcements")
          .select("id, title, body, created_at")
          .eq("published", true)
          .order("created_at", { ascending: false })
          .limit(3),
      ]);

    const totalSavings =
      contributions.data?.reduce((s, c) => s + Number(c.amount), 0) ?? 0;
    const paidThisMonth =
      contributions.data?.some((c) => c.month === currentMonth) ?? false;

    // v2 adds credit_score and loan_eligibility
    return {
      member: profile.data,
      total_savings: totalSavings,
      paid_this_month: paidThisMonth,
      current_month: currentMonth,
      active_loan: activeLoan.data,
      recent_transactions: recentTxns.data,
      announcements: announcements.data,
      credit_score: 720,         // NEW: v2 field
      loan_eligibility: 50000,   // NEW: v2 field
    };
  });
```

The original `src/routes/v1/dashboard.ts` stays untouched. v1 clients continue receiving the old shape.

### Step 3: Register v2 in the app

**`src/index.ts`**

```typescript
import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { logger } from "@bogeychan/elysia-logger";
import { v1Routes } from "./routes";
import { v2Routes } from "./routes/v2";   // NEW

const app = new Elysia()
  .use(cors({ /* ... */ }))
  .use(logger({ level: "info" }))
  .use(swagger({ /* ... */ }))

  .get("/", () => ({
    name: "DOMICOP API",
    version: "2.0.0",
    status: "running",
    documentation: "/swagger",
    health: "/health",
    base_paths: ["/v1", "/v2"],
  }))
  .get("/health", () => ({ /* ... */ }))

  .use(v1Routes)
  .use(v2Routes)   // NEW — one line suffices

  .onError(/* ... */)
  .listen(process.env.PORT ?? 3000);
```

Both versions now serve side by side:

| v1 | v2 |
|----|----|
| `GET /v1/dashboard/summary` | `GET /v2/dashboard/summary` |
| `POST /v1/auth/login` | `POST /v2/auth/login` *(same handler)* |

---

## Common Upgrade Patterns

### Adding new fields to a response

Add fields to the handler. Old clients ignore unknown keys — no need to gate the field.

```typescript
// v1 response
return { name, balance };

// v2 response — same route file, new handler in v2 dir
return { name, balance, credit_score, tier };
```

### Changing a request body shape

Create a new handler in the v2 directory with the new schema. Example — `POST /members` now takes a nested object for bank details:

```typescript
// v1 (unchanged)
body: t.Object({
  bank_name: t.String(),
  bank_account: t.String(),
  bank_code: t.String(),
})

// v2 — new handler in src/routes/v2/members.ts
body: t.Object({
  bank: t.Object({
    name: t.String(),
    account: t.String(),
    code: t.String(),
  }),
})
```

### Adding a brand new endpoint

Add it only to v2. No v1 equivalent needed.

```typescript
// src/routes/v2/members.ts
.post("/invite", async ({ body }) => {
  // Send invite email to new member
}, {
  body: t.Object({ email: t.String({ format: "email" }) }),
})
```

Result: `POST /v2/members/invite` exists, `POST /v1/members/invite` does not.

### Removing an endpoint

Omit it from the v2 aggregator. The route stays in v1 for legacy clients.

```typescript
// src/routes/v2/index.ts — notice reportRoutes is NOT listed
export const v2Routes = new Elysia({ prefix: "/v2" })
  .use(authRoutes)
  .use(memberRoutes)
  // .use(reportRoutes)  ← intentionally removed
  .use(websocketRoutes);
```

### Changing middleware behavior

If v2 needs different auth (e.g. header format changes), create a new middleware file:

```typescript
// src/middleware/authenticateV2.ts
export const authenticateV2 = new Elysia({ name: "authenticateV2" })
  .derive({ as: "global" }, async ({ headers, set }) => {
    // v2 uses X-API-Key header instead of Bearer token
    const apiKey = headers["x-api-key"];
    // ... custom validation ...
  });
```

Use it in the v2 aggregator but not v1:

```typescript
// src/routes/v2/index.ts
export const v2Routes = new Elysia({ prefix: "/v2" })
  .use(authenticateV2)   // applies to ALL v2 routes
  .use(authRoutes)
  .use(memberRoutes);
```

### Reusing unchanged routes

Import the original module directly into both aggregators. The same handler serves both versions:

```typescript
// src/routes/v1/index.ts (v1)
import { authRoutes } from "./auth";
export const v1Routes = new Elysia({ prefix: "/v1" }).use(authRoutes);

// src/routes/v2/index.ts (v2)
import { authRoutes } from "@/routes/v1/auth";
export const v2Routes = new Elysia({ prefix: "/v2" }).use(authRoutes);
```

No duplication. `POST /v1/auth/login` and `POST /v2/auth/login` share the same code.

---

## Middleware Inheritance

Global middleware (cors, logger, swagger, error handler) is defined in `src/index.ts` and applies to all versions. Versioned routes inherit it automatically.

```
src/index.ts
  ├── .use(cors)              ← applies to everything
  ├── .use(logger)            ← applies to everything
  ├── .use(swagger)           ← applies to everything
  ├── .use(v1Routes)          ← inherits cors, logger, swagger
  │     ├── .use(authRoutes)      ← prefix /v1/auth
  │     └── .use(memberRoutes)    ← prefix /v1/members
  ├── .use(v2Routes)          ← inherits cors, logger, swagger
  │     ├── .use(authRoutes)      ← prefix /v2/auth (same module)
  │     └── .use(memberRoutes)    ← prefix /v2/members (v2 version)
  └── .onError(...)           ← applies to everything
```

---

## Deprecation Timeline

| Phase | What happens | Example |
|-------|-------------|---------|
| **Release** | v2 ships alongside v1 | Day 0 |
| **Notice** | v1 responses include `Deprecation: true` and `Sunset: <date>` headers | Week 2 |
| **Warn** | Server logs a warning for each v1 request | Week 3 |
| **Redirect** | v1 endpoints return `301 Moved Permanently` to v2 equivalent | Week 5 |
| **Remove** | v1 aggregator and stale route files deleted | Week 6+ after client confirmation |

### Adding deprecation headers

Add a middleware to the v1 aggregator when deprecation begins:

```typescript
// src/routes/v1/index.ts — during the Notice phase
export const v1Routes = new Elysia({ prefix: "/v1" })
  .derive(({ set }) => {
    set.headers["Deprecation"] = "true";
    set.headers["Sunset"] = "2026-06-01";
  })
  .use(authRoutes)
  .use(memberRoutes)
  // ...
```

---

## v2 Release Checklist

Before declaring v2 ready:

- [ ] Create `src/routes/v2/index.ts` aggregator
- [ ] Version only the routes with breaking changes (copy/paste handlers only when necessary)
- [ ] Reuse all unchanged routes from v1 (import the same module)
- [ ] Register `v2Routes` in `src/index.ts`
- [ ] Swagger docs show both `/v1` and `/v2` path groups
- [ ] `GET /` root route lists both `base_paths`
- [ ] v1 endpoints still return identical responses (no regression)
- [ ] Typecheck passes: `bunx tsc --noEmit`
- [ ] Mobile client migration plan is documented
- [ ] Team notifies mobile developers of v2 availability and sunset date for v1

---

## Directory Layout After v2

```
src/
├── index.ts                     # App assembly — imports v1Routes + v2Routes
├── routes/
│   ├── v1/
│   │   ├── index.ts             # v1 aggregator (prefix: /v1)
│   │   ├── auth.ts              # Shared by v1 and v2
│   │   ├── members.ts           # v1 members
│   │   ├── dashboard.ts         # v1 dashboard
│   │   ├── contributions.ts     # Shared by v1 and v2
│   │   ├── loans.ts             # Shared by v1 and v2
│   │   ├── dividends.ts         # Shared by v1 and v2
│   │   ├── messages.ts          # Shared by v1 and v2
│   │   ├── notifications.ts     # Shared by v1 and v2
│   │   ├── websocket.ts         # Shared by v1 and v2
│   │   ├── announcements.ts     # Shared by v1 and v2
│   │   └── reports.ts           # v1 only (removed from v2)
│   └── v2/
│       ├── index.ts             # v2 aggregator (prefix: /v2)
│       ├── dashboard.ts         # v2 dashboard (different response shape)
│       └── members.ts           # v2 members (new endpoint added)
├── middleware/
│   ├── authenticate.ts           # Shared by v1 and v2
│   ├── requireAdmin.ts
│   └── ...
├── lib/
├── services/
└── ...
```
