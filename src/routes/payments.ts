import Elysia, { t }        from 'elysia'
import { authenticate }     from '../middleware/authenticate'
import { requireAdmin }     from '../middleware/requireAdmin'
import { validateWebhook }  from '../middleware/validateWebhook'
import { paymentRateLimit } from '../middleware/rateLimiter'
import { supabase }         from '../lib/supabase'
import { paystack }         from '../lib/paystack'
import { paginationQS, paginate } from '../utils/validators'

export const paymentRoutes = new Elysia({ prefix: '/payments' })
  .use(authenticate)
  .use(paymentRateLimit)

  // transactions/make-payment.tsx → POST /payments/initiate
  .post('/initiate',
    async ({ userId, body }) => {
      const { data: authUser } = await supabase.auth.admin.getUserById(userId)
      if (!authUser.user) throw new Error('User not found')

      const txData = await paystack.initializeTransaction({
        email:        authUser.user.email!,
        amount:       body.amount,
        callback_url: `${process.env.API_BASE_URL}/payments/verify`,
        metadata: {
          member_id:       userId,
          type:            body.type,
          contribution_id: body.contribution_id ?? null,
          loan_id:         body.loan_id         ?? null,
        },
      })
      return txData
    },
    {
      body: t.Object({
        amount:          t.Number({ minimum: 100 }),
        type:            t.Union([t.Literal('contribution'), t.Literal('loan_repayment'), t.Literal('levy')]),
        contribution_id: t.Optional(t.String()),
        loan_id:         t.Optional(t.String()),
      }),
    }
  )

  // success/index.tsx → GET /payments/:ref/status
  // The success screen passes the Paystack reference as a query param after redirect
  .get('/:ref/status',
    async ({ params, userId }) => {
      // First check our DB
      const { data: existing } = await supabase.from('transactions')
        .select('*').eq('paystack_ref', params.ref).eq('member_id', userId).maybeSingle()

      if (existing) return existing

      // If not yet processed (webhook may be delayed), verify directly with Paystack
      const verified = await paystack.verifyTransaction(params.ref)
      return {
        paystack_ref: params.ref,
        status:       verified.status,
        amount:       verified.amount / 100,
        pending_webhook: true,
      }
    }
  )

  .get('/me',
    async ({ userId, query }) => {
      const { from, to } = paginate(query.page, query.limit)
      const { data, error } = await supabase.from('transactions')
        .select('*').eq('member_id', userId).order('created_at', { ascending: false }).range(from, to)
      if (error) throw new Error(error.message)
      return data
    },
    { query: paginationQS }
  )

  .use(requireAdmin)
  .get('/',
    async ({ query }) => {
      const { from, to } = paginate(query.page, query.limit)
      const { data, error, count } = await supabase.from('transactions')
        .select('*, profiles(full_name, member_no)', { count: 'exact' })
        .order('created_at', { ascending: false }).range(from, to)
      if (error) throw new Error(error.message)
      return { data, total: count }
    },
    { query: paginationQS }
  )

// Webhook handler — separate instance, mounts at root level in index.ts BEFORE body parsing
export const webhookHandler = new Elysia()
  .use(validateWebhook)
  .post('/payments/webhook',
    async ({ webhookPayload }) => {
      const { event, data } = webhookPayload

      if (event === 'charge.success') {
        const { reference, amount, channel, metadata } = data

        await supabase.from('transactions').upsert({
          paystack_ref:    reference,
          member_id:       metadata.member_id,
          amount:          amount / 100,
          type:            metadata.type,
          status:          'success',
          channel,
          contribution_id: metadata.contribution_id ?? null,
          loan_id:         metadata.loan_id         ?? null,
        }, { onConflict: 'paystack_ref' })

        if (metadata.contribution_id) {
          await supabase.from('contributions')
            .update({ status: 'verified', payment_ref: reference, updated_at: new Date().toISOString() })
            .eq('id', metadata.contribution_id)
        }

        if (metadata.loan_id) {
          const { data: loan } = await supabase.from('loans').select('balance').eq('id', metadata.loan_id).single()
          if (loan) {
            const newBalance = Math.max(0, Number(loan.balance) - amount / 100)
            await supabase.from('loans').update({
              balance:    newBalance,
              status:     newBalance === 0 ? 'closed' : 'repaying',
              updated_at: new Date().toISOString(),
            }).eq('id', metadata.loan_id)
          }
        }
      }

      if (event === 'transfer.success') {
        await supabase.from('dividends').update({ status: 'success' }).eq('paystack_transfer_ref', data.transfer_code)
      }

      if (event === 'transfer.failed') {
        await supabase.from('dividends').update({ status: 'failed' }).eq('paystack_transfer_ref', data.transfer_code)
      }

      return { received: true }
    }
  )
