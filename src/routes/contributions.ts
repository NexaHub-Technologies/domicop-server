import Elysia, { t }    from 'elysia'
import { authenticate } from '../middleware/authenticate'
import { requireAdmin } from '../middleware/requireAdmin'
import { supabase }     from '../lib/supabase'
import { writeAuditLog } from '../utils/audit'
import { paginationQS, paginate } from '../utils/validators'

export const contributionRoutes = new Elysia({ prefix: '/contributions' })
  .use(authenticate)

  // transactions/contribution-details.tsx → GET /contributions/me
  .get('/me',
    async ({ userId, query }) => {
      let q = supabase.from('contributions').select('*').eq('member_id', userId).order('created_at', { ascending: false })
      if (query.year)  q = q.eq('year',  query.year)
      if (query.month) q = q.eq('month', query.month)
      const { data, error } = await q
      if (error) throw new Error(error.message)
      return data
    },
    { query: t.Partial(t.Object({ year: t.Numeric(), month: t.String() })) }
  )

  // transactions/add-contribution.tsx → POST /contributions
  .post('/',
    async ({ userId, body }) => {
      // Prevent duplicate contribution for the same month
      const { data: existing } = await supabase.from('contributions')
        .select('id, status').eq('member_id', userId).eq('month', body.month).maybeSingle()

      if (existing && existing.status !== 'rejected') {
        throw new Error(`A contribution for ${body.month} already exists with status: ${existing.status}`)
      }

      const { data, error } = await supabase.from('contributions').insert({
        member_id: userId,
        amount:    body.amount,
        month:     body.month,
        year:      parseInt(body.month.split('-')[0]),
        proof_url: body.proof_url ?? null,
        notes:     body.notes    ?? null,
        status:    'pending',
      }).select().single()
      if (error) throw new Error(error.message)
      return data
    },
    {
      body: t.Object({
        amount:    t.Number({ minimum: 1 }),
        month:     t.String({ pattern: '^[0-9]{4}-[0-9]{2}$' }),
        proof_url: t.Optional(t.String()),
        notes:     t.Optional(t.String()),
      }),
    }
  )

  // transactions/contribution-details-info.tsx → GET /contributions/:id
  .get('/:id',
    async ({ params, userId }) => {
      const { data, error } = await supabase.from('contributions')
        .select('*, transactions(paystack_ref, channel, created_at)')
        .eq('id', params.id).eq('member_id', userId).single()
      if (error) throw new Error('Contribution not found')
      return data
    }
  )

  // Admin routes
  .use(requireAdmin)

  .get('/',
    async ({ query }) => {
      const { from, to } = paginate(query.page, query.limit)
      let q = supabase.from('contributions')
        .select('*, profiles(full_name, member_no)', { count: 'exact' })
        .order('created_at', { ascending: false }).range(from, to)
      if (query.status)    q = q.eq('status', query.status)
      if (query.member_id) q = q.eq('member_id', query.member_id)
      if (query.year)      q = q.eq('year', query.year)
      const { data, error, count } = await q
      if (error) throw new Error(error.message)
      return { data, total: count }
    },
    { query: t.Partial(t.Object({ page: t.Numeric(), limit: t.Numeric(), status: t.String(), member_id: t.String(), year: t.Numeric() })) }
  )

  .patch('/:id/status',
    async ({ params, body, userId }) => {
      const { data, error } = await supabase.from('contributions')
        .update({ status: body.status, updated_at: new Date().toISOString() })
        .eq('id', params.id).select().single()
      if (error) throw new Error(error.message)
      await writeAuditLog({ actor_id: userId, action: `contribution_${body.status}`, entity: 'contributions', entity_id: params.id })
      return data
    },
    { body: t.Object({ status: t.Union([t.Literal('verified'), t.Literal('rejected')]) }) }
  )
