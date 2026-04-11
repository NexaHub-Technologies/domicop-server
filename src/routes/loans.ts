import Elysia, { t }    from 'elysia'
import { authenticate } from '../middleware/authenticate'
import { requireAdmin } from '../middleware/requireAdmin'
import { requireActive } from '../middleware/requireActive'
import { supabase }     from '../lib/supabase'
import { writeAuditLog } from '../utils/audit'
import { paginationQS, paginate } from '../utils/validators'

export const loanRoutes = new Elysia({ prefix: '/loans' })
  .use(authenticate)

  // (tabs)/loans.tsx → GET /loans/me
  .get('/me', async ({ userId }) => {
    const { data, error } = await supabase.from('loans')
      .select('*').eq('member_id', userId).order('created_at', { ascending: false })
    if (error) throw new Error(error.message)
    return data
  })

  // transactions/apply-for-loan.tsx → POST /loans/apply
  // Requires active account status (pending users cannot apply for loans)
  .use(requireActive)
  .post('/apply',
    async ({ userId, body }) => {
      const { count } = await supabase.from('contributions').select('*', { count: 'exact', head: true })
        .eq('member_id', userId).eq('status', 'verified')

      if ((count ?? 0) < 3) throw new Error('Minimum 3 verified contributions required to apply')

      const { data: existing } = await supabase.from('loans').select('id')
        .eq('member_id', userId).in('status', ['pending', 'under_review', 'approved', 'disbursed', 'repaying']).maybeSingle()

      if (existing) throw new Error('You already have an active loan')

      const { data, error } = await supabase.from('loans').insert({
        member_id:        userId,
        amount_requested: body.amount,
        purpose:          body.purpose,
        type:             body.type,
        tenure_months:    body.tenure_months,
        guarantor_id:     body.guarantor_id   ?? null,
        documents_url:    body.documents_url  ?? [],
        status:           'pending',
      }).select().single()
      if (error) throw new Error(error.message)
      return data
    },
    {
      body: t.Object({
        amount:        t.Number({ minimum: 1000 }),
        purpose:       t.String({ minLength: 10 }),
        type:          t.Union([t.Literal('emergency'), t.Literal('personal'), t.Literal('housing'), t.Literal('education'), t.Literal('business')]),
        tenure_months: t.Number({ minimum: 1, maximum: 36 }),
        guarantor_id:  t.Optional(t.String()),
        documents_url: t.Optional(t.Array(t.String())),
      }),
    }
  )

  // loans/[id].tsx → GET /loans/:id
  .get('/:id',
    async ({ params, userId }) => {
      const { data, error } = await supabase.from('loans')
        .select('*, transactions(paystack_ref, amount, created_at, channel)')
        .eq('id', params.id).eq('member_id', userId).single()
      if (error) throw new Error('Loan not found')
      return data
    }
  )

  .use(requireAdmin)

  .get('/',
    async ({ query }) => {
      const { from, to } = paginate(query.page, query.limit)
      let q = supabase.from('loans')
        .select('*, profiles(full_name, member_no)', { count: 'exact' })
        .order('created_at', { ascending: false }).range(from, to)
      if (query.status) q = q.eq('status', query.status)
      const { data, error, count } = await q
      if (error) throw new Error(error.message)
      return { data, total: count }
    },
    { query: t.Partial(t.Object({ page: t.Numeric(), limit: t.Numeric(), status: t.String() })) }
  )

  .patch('/:id/process',
    async ({ params, body, userId }) => {
      const updates: Record<string, unknown> = {
        status: body.status, admin_notes: body.admin_notes ?? null, updated_at: new Date().toISOString(),
      }
      if (body.status === 'approved' && body.amount_approved) {
        const rate = body.interest_rate ?? 5
        const total = body.amount_approved * (1 + rate / 100)
        Object.assign(updates, {
          amount_approved:   body.amount_approved,
          interest_rate:     rate,
          tenure_months:     body.tenure_months,
          monthly_repayment: parseFloat((total / body.tenure_months!).toFixed(2)),
          balance:           parseFloat(total.toFixed(2)),
          due_date:          new Date(Date.now() + body.tenure_months! * 30 * 86400000).toISOString(),
        })
      }
      const { data, error } = await supabase.from('loans')
        .update(updates).eq('id', params.id).select().single()
      if (error) throw new Error(error.message)
      await writeAuditLog({ actor_id: userId, action: `loan_${body.status}`, entity: 'loans', entity_id: params.id })
      return data
    },
    {
      body: t.Object({
        status:          t.Union([t.Literal('approved'), t.Literal('rejected'), t.Literal('under_review'), t.Literal('disbursed')]),
        amount_approved: t.Optional(t.Number()),
        interest_rate:   t.Optional(t.Number()),
        tenure_months:   t.Optional(t.Number()),
        admin_notes:     t.Optional(t.String()),
      }),
    }
  )
