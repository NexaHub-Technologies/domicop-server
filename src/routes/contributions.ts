import Elysia, { t } from "elysia";
import { authenticate } from "../middleware/authenticate";
import { requireAdmin } from "../middleware/requireAdmin";
import { requireActive } from "../middleware/requireActive";
import { supabase } from "../lib/supabase";
import { writeAuditLog } from "../utils/audit";
import { paginationQS, paginate } from "../utils/validators";

export const contributionRoutes = new Elysia({ prefix: "/contributions" })
  .use(authenticate)

  // (tabs)/savings.tsx + transactions/contribution-details.tsx → GET /contributions/me
  // Returns contributions list with balance summary and transaction history
  .get(
    "/me",
    async ({ userId, query }) => {
      const year = query.year ?? new Date().getFullYear();
      const { from, to } = paginate(query.page ?? 1, query.limit ?? 20);

      const [contributions, transactions] = await Promise.all([
        supabase
          .from("contributions")
          .select("amount, month, year, payment_status, transaction_ref")
          .eq("member_id", userId)
          .eq("payment_status", "success"),

        supabase
          .from("transactions")
          .select(
            "id, amount, type, status, channel, description, created_at, paystack_ref",
            {
              count: "exact",
            },
          )
          .eq("member_id", userId)
          .order("created_at", { ascending: false })
          .range(from, to),
      ]);

      // Calculate total savings balance
      const totalBalance =
        contributions.data?.reduce((s, c) => s + Number(c.amount), 0) ?? 0;

      // Calculate yearly balance
      const yearBalance =
        contributions.data
          ?.filter((c) => c.year === year)
          .reduce((s, c) => s + Number(c.amount), 0) ?? 0;

      // Calculate monthly breakdown
      const monthlyBreakdown =
        contributions.data?.reduce<Record<string, number>>((acc, c) => {
          acc[c.month] = (acc[c.month] ?? 0) + Number(c.amount);
          return acc;
        }, {}) ?? {};

      // Filter contributions by query params if provided
      let filteredContributions = contributions.data ?? [];
      if (query.year) {
        filteredContributions = filteredContributions.filter(
          (c) => c.year === query.year,
        );
      }
      if (query.month) {
        filteredContributions = filteredContributions.filter(
          (c) => c.month === query.month,
        );
      }

      return {
        contributions: filteredContributions,
        total_balance: totalBalance,
        year_balance: yearBalance,
        monthly_breakdown: monthlyBreakdown,
        transactions: transactions.data,
        total_transactions: transactions.count,
        page: query.page ?? 1,
        limit: query.limit ?? 20,
      };
    },
    {
      query: t.Partial(
        t.Object({
          year: t.Numeric(),
          month: t.String(),
          page: t.Numeric(),
          limit: t.Numeric(),
        }),
      ),
    },
  )

  // transactions/add-contribution.tsx → POST /contributions
  // Requires active account status (pending users cannot contribute)
  .use(requireActive)
  .post(
    "/",
    async ({ userId, body }) => {
      // Prevent duplicate contribution for the same month
      const { data: existing } = await supabase
        .from("contributions")
        .select("id, payment_status")
        .eq("member_id", userId)
        .eq("month", body.month)
        .maybeSingle();

      if (
        existing &&
        existing.payment_status !== "failed" &&
        existing.payment_status !== "abandoned"
      ) {
        throw new Error(
          `A contribution for ${body.month} already exists with status: ${existing.payment_status}`,
        );
      }

      const { data, error } = await supabase
        .from("contributions")
        .insert({
          member_id: userId,
          amount: body.amount,
          month: body.month,
          year: parseInt(body.month.split("-")[0]),
          notes: body.notes ?? null,
          payment_status: "pending",
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    {
      body: t.Object({
        amount: t.Number({ minimum: 1 }),
        month: t.String({ pattern: "^[0-9]{4}-[0-9]{2}$" }),
        notes: t.Optional(t.String()),
      }),
    },
  )

  // transactions/contribution-details-info.tsx → GET /contributions/:id
  .get("/:id", async ({ params, userId }) => {
    const { data, error } = await supabase
      .from("contributions")
      .select("*, transactions(paystack_ref, channel, created_at)")
      .eq("id", params.id)
      .eq("member_id", userId)
      .single();
    if (error) throw new Error("Contribution not found");
    return data;
  })

  // Admin routes
  .use(requireAdmin)

  .get(
    "/",
    async ({ query }) => {
      const { from, to } = paginate(query.page, query.limit);
      let q = supabase
        .from("contributions")
        .select("*, profiles(full_name, member_no)", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(from, to);
      if (query.status) q = q.eq("payment_status", query.status);
      if (query.member_id) q = q.eq("member_id", query.member_id);
      if (query.year) q = q.eq("year", query.year);
      const { data, error, count } = await q;
      if (error) throw new Error(error.message);
      return { data, total: count };
    },
    {
      query: t.Partial(
        t.Object({
          page: t.Numeric(),
          limit: t.Numeric(),
          status: t.String(),
          member_id: t.String(),
          year: t.Numeric(),
        }),
      ),
    },
  )

  .patch(
    "/:id/status",
    async ({ params, body, userId }) => {
      const { data, error } = await supabase
        .from("contributions")
        .update({ payment_status: body.status, updated_at: new Date().toISOString() })
        .eq("id", params.id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      await writeAuditLog({
        actor_id: userId,
        action: `contribution_${body.status}`,
        entity: "contributions",
        entity_id: params.id,
      });
      return data;
    },
    {
      body: t.Object({
        status: t.Union([
          t.Literal("success"),
          t.Literal("failed"),
          t.Literal("abandoned"),
          t.Literal("pending"),
        ]),
      }),
    },
  );
