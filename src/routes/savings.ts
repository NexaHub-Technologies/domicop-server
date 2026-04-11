import Elysia, { t }    from 'elysia'
import { authenticate } from '../middleware/authenticate'
import { supabase }     from '../lib/supabase'
import { paginationQS, paginate } from '../utils/validators'

export const savingsRoutes = new Elysia({ prefix: '/savings' })
  .use(authenticate)

  // (tabs)/savings.tsx → GET /savings/me
  // Returns account balance summary + paginated transaction history
  .get('/me',
    async ({ userId, query }) => {
      const year = query.year ?? new Date().getFullYear()
      const { from, to } = paginate(query.page, query.limit)

      const [contributions, transactions] = await Promise.all([
        supabase.from('contributions')
          .select('amount, month, year, status')
          .eq('member_id', userId).eq('status', 'verified'),

        supabase.from('transactions')
          .select('id, amount, type, status, channel, description, created_at, paystack_ref', { count: 'exact' })
          .eq('member_id', userId)
          .order('created_at', { ascending: false })
          .range(from, to),
      ])

      const totalBalance   = contributions.data?.reduce((s, c) => s + Number(c.amount), 0) ?? 0
      const yearBalance    = contributions.data?.filter(c => c.year === year).reduce((s, c) => s + Number(c.amount), 0) ?? 0
      const monthlyBreakdown = contributions.data?.reduce<Record<string, number>>((acc, c) => {
        acc[c.month] = (acc[c.month] ?? 0) + Number(c.amount)
        return acc
      }, {})

      return {
        total_balance:     totalBalance,
        year_balance:      yearBalance,
        monthly_breakdown: monthlyBreakdown,
        transactions:      transactions.data,
        total_transactions: transactions.count,
        page:  query.page  ?? 1,
        limit: query.limit ?? 20,
      }
    },
    { query: t.Partial(t.Object({ year: t.Numeric(), page: t.Numeric(), limit: t.Numeric() })) }
  )

  // savings/[id].tsx → GET /savings/:id
  // Single transaction detail for TransactionDetailScreen
  .get('/:id',
    async ({ params, userId }) => {
      const { data, error } = await supabase
        .from('transactions')
        .select('*, contributions(month, year, proof_url, notes)')
        .eq('id', params.id)
        .eq('member_id', userId)
        .single()
      if (error) throw new Error('Transaction not found')
      return data
    }
  )
