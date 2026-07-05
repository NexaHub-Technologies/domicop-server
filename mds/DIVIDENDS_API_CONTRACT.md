# DOMICOP Dividends API Contract (Admin Portal)

The contract the admin portal builds against for the `/dividends` route. Shapes
are taken from the route handlers in `src/routes/v1/dividends.ts`, not
aspirational.

All three endpoints are admin-only (`authenticate` + `requireAdmin`). A member
token gets `403` on every call.

---

## 1. Conventions

| Aspect | Value |
| --- | --- |
| Base URL | `https://<api-host>/v1` |
| Auth | `Authorization: Bearer <supabase_access_token>` on every request |
| Content type | `application/json` |
| Timestamps | ISO-8601 UTC strings (e.g. `2026-07-03T01:27:38.505Z`) |
| IDs | UUID strings |
| CORS | Allowed origins: `CLIENT_ADMIN_ORIGIN` env, `http://localhost:3001` |

### Money units — read carefully

The dividends endpoints use **naira** for payout amounts, but the preview
endpoint also surfaces raw contribution data from the contributions table, which
is in **kobo**. This is a real inconsistency in the backend — not a
documentation simplification.

| Endpoint | Field | Unit |
| --- | --- | --- |
| `GET /dividends` | `amount` | **naira** |
| `POST /dividends/preview` | `total_amount` (input) | **naira** |
| `POST /dividends/preview` | `dividend_amount` | **naira** |
| `POST /dividends/preview` | `grand_total_contributions` | **kobo** |
| `POST /dividends/preview` | `contribution_amount` | **kobo** |
| `POST /dividends/distribute` | `dividends[].amount` | **naira** |

⚠️ **Never compare `dividend_amount` (naira) to `contribution_amount` or
`grand_total_contributions` (kobo) without converting first.** Divide the kobo
value by 100 before comparing. See §6 for client helpers.

### Error envelope

All thrown errors return `{ "error": string }` with an appropriate status.
Validation failures additionally include `details`:

```json
// 422 Unprocessable Entity
{ "error": "Validation failed", "details": "<which field and why>" }
```

| Status | Meaning |
| --- | --- |
| 401 | Missing/invalid/expired token |
| 403 | Authenticated but not an admin (`{ "error": "Admin access required" }`) |
| 404 | Route or resource not found |
| 422 | Body/query failed schema validation |
| 500 | Unhandled server error (`{ "error": "<message>" }`) |

### Dividend status values

`processing` → `success` | `failed`

- **processing**: Paystack transfer initiated, awaiting confirmation.
- **success**: Paystack confirmed the transfer succeeded (via webhook).
- **failed**: Transfer failed (bank rejection, insufficient balance, etc.).

The API returns `processing` or `failed` at call time. The `success` state
arrives asynchronously via the Paystack `transfer.success` webhook. See §5 for
client reconciliation guidance.

### Dividend object

```ts
type Dividend = {
  id: string;
  member_id: string;
  amount: number;               // naira
  year: number;
  paystack_transfer_ref: string | null;
  status: "processing" | "success" | "failed";
  created_at: string;           // ISO-8601
};
```

When listed via `GET /dividends`, each row is joined with the member profile:

```ts
type DividendWithProfile = Dividend & {
  profiles: {
    full_name: string;
    member_no: string | null;
  };
};
```

---

## 2. `GET /dividends` — list dividends

Screen: admin dividends list. Requires admin auth.

Returns all dividends for the given year, newest first, with the member's
`full_name` and `member_no` joined in.

```
GET /v1/dividends?year=2026
```

| Param | Type | Required | Default |
| --- | --- | --- | --- |
| `year` | number | no | current year |

```json
// 200
{
  "data": [
    {
      "id": "uuid",
      "member_id": "uuid",
      "amount": 5882,
      "year": 2026,
      "paystack_transfer_ref": "TRF_xxx",
      "status": "processing",
      "created_at": "2026-07-03T01:27:38.505Z",
      "profiles": {
        "full_name": "Jane Doe",
        "member_no": "DOMICOP-0001"
      }
    }
  ],
  "total": null
}
```

### Response handling

**`total` is hardcoded to `null`** — the server does not return an actual row
count for this endpoint. To display a count, use `data.length`:

```ts
const dividends = await fetchDividends({ year: 2026 });
displayCount(dividends.data.length); // not dividends.total
```

This differs from other admin list endpoints (`/contributions`, `/loans`,
`/members`) which return an actual count in `total`.

### Failure statuses

| Status | Body | Meaning |
| --- | --- | --- |
| 401 | `{ "error": "…" }` | missing/invalid token |
| 403 | `{ "error": "Admin access required" }` | not an admin |

---

## 3. `POST /dividends/preview` — preview distribution

Screen: admin dividend preview / calculator. Requires admin auth.

Computes a proportional distribution of a total pool across all active members
based on their verified contributions for the year. **This is a read-only
endpoint — no database writes occur.**

```
POST /v1/dividends/preview
```

```json
// request
{
  "year": 2026,
  "total_amount": 100000        // naira, the pool to share
}
```

| Field | Type | Required | Min | Unit |
| --- | --- | --- | --- | --- |
| `year` | number | yes | — | calendar year |
| `total_amount` | number | yes | 1 | **naira** |

```json
// 200
{
  "year": 2026,
  "total_amount": 100000,
  "total_members": 12,
  "grand_total_contributions": 8500000,
  "preview": [
    {
      "member_id": "uuid",
      "full_name": "Jane Doe",
      "member_no": "DOMICOP-0001",
      "contribution_amount": 500000,
      "dividend_amount": 5882.35
    }
  ]
}
```

### Response fields

| Field | Unit | Notes |
| --- | --- | --- |
| `year` | — | echoed from request |
| `total_amount` | **naira** | echoed from request |
| `total_members` | count | members receiving `dividend_amount > 0` |
| `grand_total_contributions` | **kobo** | sum of all verified contributions for the year |
| `preview[].member_id` | — | UUID |
| `preview[].full_name` | — | member's full name |
| `preview[].member_no` | — | e.g. `DOMICOP-0001` |
| `preview[].contribution_amount` | **kobo** | this member's total verified contributions |
| `preview[].dividend_amount` | **naira** | calculated payout for this member |

### ⚠️ Currency mismatch in preview

The preview response contains amounts in **two different units**:

- `total_amount` and `dividend_amount` are in **naira** (the transfer layer).
- `grand_total_contributions` and `contribution_amount` are in **kobo** (read
  directly from the contributions table).

To compare a member's contribution to their dividend, convert first:

```ts
const contributionNaira = previewMember.contribution_amount / 100;
const ratio = contributionNaira / (grandTotalContributions / 100);
// now ratio * totalAmount === previewMember.dividend_amount (within rounding)
```

This mismatch is a known backend inconsistency. It will be normalized in a
future release — track as a follow-up.

### Algorithm

1. Fetch all active members (`profiles` where `status = "active"`).
2. Fetch all verified contributions for the year (`payment_status = "success"`).
3. Aggregate contributions per member into `memberTotals`.
4. For each active member: `dividend = total_amount × (memberContrib / grandTotal)`.
5. Filter out members with `dividend_amount === 0`.

Safe to call repeatedly — no side effects.

### Failure statuses

| Status | Body | Meaning |
| --- | --- | --- |
| 422 | `{ "error": "Validation failed", "details": "…" }` | body invalid (e.g. `total_amount < 1`) |
| 500 | `{ "error": "No active members found" }` | no active members in the system |

---

## 4. `POST /dividends/distribute` — execute distribution

Screen: admin dividend distribution confirmation. Requires admin auth.

Initiates Paystack transfers for each member in the supplied list. **This
endpoint is not transactional** — each transfer is processed in a loop and
outcomes are reported individually. Some may succeed while others fail.

```
POST /v1/dividends/distribute
```

```json
// request
{
  "year": 2026,
  "dividends": [
    { "member_id": "uuid", "amount": 5882 },
    { "member_id": "uuid", "amount": 3200 }
  ]
}
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `year` | number | yes | calendar year |
| `dividends` | array | yes | ≥ 1 entry |
| `dividends[].member_id` | string (UUID) | yes | target member |
| `dividends[].amount` | number | yes | **naira**, min 1 |

```json
// 200
{
  "results": [
    {
      "member_id": "uuid",
      "status": "processing",
      "transfer_code": "TRF_xxxxxxxx"
    },
    {
      "member_id": "uuid",
      "status": "failed",
      "error": "Missing bank details"
    }
  ]
}
```

### Per-member result

| Field | When | Notes |
| --- | --- | --- |
| `member_id` | always | the target member |
| `status` | always | `"processing"` or `"failed"` |
| `transfer_code` | `status = "processing"` | Paystack transfer reference |
| `error` | `status = "failed"` | reason string (e.g. `"Missing bank details"`) |

### What happens per member

For each dividend entry the server:

1. Fetches the member's `bank_name`, `bank_account`, `bank_code` from
   `profiles`.
2. If bank details are missing → pushes `{ status: "failed", error: "Missing
   bank details" }` and skips.
3. Creates a Paystack transfer recipient.
4. Initiates a Paystack transfer.
5. Inserts a `dividends` row with `status: "processing"` and the transfer ref.
6. If any step throws → pushes `{ status: "failed", error: <message> }`.

An audit log is written after the loop completes.

### Response handling

- **Do not treat the entire response as success/failure.** Iterate
  `results[]` and handle each entry individually.
- Display per-member status in the UI (green checkmark for `processing`, red
  X for `failed` with the error message).
- `processing` does **not** mean the money arrived — it means the transfer was
  initiated. See §5 for reconciliation.

### Failure statuses

| Status | Body | Meaning |
| --- | --- | --- |
| 422 | `{ "error": "Validation failed", "details": "…" }` | body invalid (e.g. empty `dividends` array, `amount < 1`) |
| 500 | `{ "error": "…" }` | unexpected server error |

---

## 5. Reconciling transfer outcomes

The `/distribute` endpoint returns `processing` for each initiated transfer.
The **authoritative outcome** arrives asynchronously via Paystack webhooks:

| Webhook event | Meaning | Client action |
| --- | --- | --- |
| `transfer.success` | Money delivered to member's bank | Update dividend `status` to `success` |
| `transfer.failed` | Transfer rejected by bank | Update dividend `status` to `failed` |

The webhook handler updates the `dividends` table and notifies admins via
the `admin-notifications` WebSocket channel (see `ADMIN_API_CONTRACT.md` §12).

**Client reconciliation pattern:**

1. After calling `/distribute`, show each member as "processing" in the UI.
2. Listen to the admin WebSocket for `transfer.success` / `transfer.failed`
   events, or poll `GET /dividends?year=` periodically.
3. When a dividend's `status` changes from `processing` to `success` or
   `failed`, update the UI accordingly.

```ts
// Polling example
async function refreshDividends(year: number) {
  const { data } = await api.get(`/dividends?year=${year}`);
  // data[] now reflects the latest status from webhook updates
  return data;
}
```

Do **not** assume all `processing` transfers will succeed. Some will fail due
to bank-side rejections (invalid account, closed account, etc.). The webhook
handler records these as `failed` and notifies admins.

---

## 6. Client helpers

Reference helpers are defined in `docs/currency-contract.md`. The ones
relevant to dividends:

```ts
/** kobo → ₦, for reading preview.contribution_amount and grand_total_contributions. */
export const koboToNaira = (kobo: number): number => kobo / 100;

/** ₦ → kobo, only needed if sending to Paystack directly (not used in dividends). */
export const nairaToKobo = (naira: number): number => Math.round(naira * 100);
```

**Preview currency normalization** — to display contribution amounts in naira:

```ts
function normalizePreview(preview: PreviewResponse) {
  return {
    ...preview,
    grand_total_contributions_naira: preview.grand_total_contributions / 100,
    preview: preview.preview.map((p) => ({
      ...p,
      contribution_amount_naira: p.contribution_amount / 100,
    })),
  };
}
```

**Amount formatting** — for displaying dividend amounts:

```ts
import { formatNaira } from "./currency-contract";

formatNaira(dividend.amount);          // "₦5,882.00"
formatNaira(previewMember.dividend_amount); // "₦5,882.35"
```

---

## 7. Quick reference

| Method | Path | Purpose | Response shape |
| --- | --- | --- | --- |
| GET | `/dividends?year=` | List dividends for a year | `{ data: DividendWithProfile[], total: null }` |
| POST | `/dividends/preview` | Preview proportional distribution | `{ year, total_amount, total_members, grand_total_contributions, preview[] }` |
| POST | `/dividends/distribute` | Execute Paystack transfers | `{ results: [{ member_id, status, transfer_code?, error? }] }` |

---

## 8. Notes for implementers

- **`total` is `null` on GET** — use `data.length` for the count. This is
  inconsistent with other admin list endpoints. A future fix should return the
  actual count.
- **Preview mixes naira and kobo** — `dividend_amount` is naira,
  `contribution_amount` is kobo. Convert before comparing. This will be
  normalized in a future release.
- **Distribute is not transactional** — each member transfer is independent.
  Inspect each `results[]` entry. Do not wrap the call in a transaction or
  expect atomic success/failure.
- **`processing` is not final** — the real outcome arrives via Paystack webhook.
  Reflect "processing" in the UI and reconcile on webhook events.
- **Bank details required** — members without `bank_account` and `bank_code`
  in their profile will fail. The client should warn admins before distributing
  if any member is missing bank details (consider a pre-flight check on the
  member list).
- **Audit trail** — every `/distribute` call writes an audit log entry with the
  year and count of dividends processed. Admins can review this in the audit
  trail.
