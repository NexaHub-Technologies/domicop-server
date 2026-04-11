import Elysia, { t }        from 'elysia'
import { authenticate }     from '../middleware/authenticate'
import { requireAdmin }     from '../middleware/requireAdmin'
import { validateWebhook }  from '../middleware/validateWebhook'
import { paymentRateLimit } from '../middleware/rateLimiter'
import { supabase }         from '../lib/supabase'
import { paystack }         from '../lib/paystack'
import { paginationQS, paginate } from '../utils/validators'
import { 
  generatePaystackReference,
  createPendingTransaction,
  processSuccessfulPayment,
  processFailedPayment,
  getPendingTransaction,
  recordPaymentAttempt,
} from '../services/paymentService'

export const paymentRoutes = new Elysia({ prefix: '/payments' })
  .use(authenticate)
  .use(paymentRateLimit)

  // POST /payments/prepare - Backend generates reference and creates pending transaction
  .post('/prepare',
    async ({ userId, body }) => {
      const { data: authUser } = await supabase.auth.admin.getUserById(userId)
      if (!authUser.user) throw new Error('User not found')

      // Generate unique reference on backend
      const reference = generatePaystackReference(body.type, userId)

      // Create pending transaction record
      const transaction = await createPendingTransaction({
        reference,
        memberId: userId,
        amount: body.amount,
        type: body.type,
        metadata: {
          member_id: userId,
          type: body.type,
          contribution_id: body.contribution_id,
          loan_id: body.loan_id,
        },
        contributionId: body.contribution_id,
        loanId: body.loan_id,
      })

      // Record the attempt
      await recordPaymentAttempt({
        memberId: userId,
        reference,
        status: 'initiated',
        metadata: {
          amount: body.amount,
          type: body.type,
        },
      })

      // Initialize with Paystack
      const paystackData = await paystack.initializeTransaction({
        email: authUser.user.email!,
        amount: body.amount,
        reference,
        metadata: {
          member_id: userId,
          type: body.type,
          contribution_id: body.contribution_id ?? null,
          loan_id: body.loan_id ?? null,
          transaction_id: transaction.id,
        },
      })

      return {
        authorization_url: paystackData.authorization_url,
        reference: paystackData.reference,
        access_code: paystackData.access_code,
        transaction_id: transaction.id,
      }
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

  // POST /payments/verify - Verify and record payment from mobile app
  .post('/verify',
    async ({ userId, body }) => {
      const { reference, status } = body

      // Verify with Paystack API first (security)
      let verified
      try {
        verified = await paystack.verifyTransaction(reference)
      } catch (error) {
        // Record the verification failure
        await recordPaymentAttempt({
          memberId: userId,
          reference,
          status: 'failed',
          errorMessage: `Paystack verification failed: ${(error as Error).message}`,
        })
        throw new Error('Failed to verify payment with Paystack')
      }

      // Check if payment was actually successful
      if (verified.status !== 'success') {
        await processFailedPayment(reference, userId, {
          paystack_status: verified.status,
          gateway_response: verified.gateway_response,
        })
        
        await recordPaymentAttempt({
          memberId: userId,
          reference,
          status: 'failed',
          errorMessage: `Payment status: ${verified.status}`,
          metadata: { paystack_response: verified },
        })

        return {
          success: false,
          status: verified.status,
          message: `Payment verification failed: ${verified.status}`,
          reference,
        }
      }

      // Verify this transaction belongs to the user
      const pendingTx = await getPendingTransaction(reference, userId)
      if (!pendingTx) {
        // Check if it's already processed
        const { data: existingTx } = await supabase
          .from('transactions')
          .select('*')
          .eq('paystack_ref', reference)
          .eq('member_id', userId)
          .eq('status', 'success')
          .maybeSingle()

        if (existingTx) {
          return {
            success: true,
            alreadyProcessed: true,
            transaction: existingTx,
          }
        }

        throw new Error('Transaction not found or does not belong to user')
      }

      // Process successful payment
      try {
        const transaction = await processSuccessfulPayment(reference, verified, userId)
        
        await recordPaymentAttempt({
          memberId: userId,
          reference,
          status: 'success',
          metadata: { transaction_id: transaction.id },
        })

        return {
          success: true,
          transaction: {
            id: transaction.id,
            reference: transaction.paystack_ref,
            amount: transaction.amount,
            type: transaction.type,
            status: transaction.status,
            created_at: transaction.created_at,
          },
        }
      } catch (error) {
        await recordPaymentAttempt({
          memberId: userId,
          reference,
          status: 'failed',
          errorMessage: `Processing error: ${(error as Error).message}`,
        })
        throw error
      }
    },
    {
      body: t.Object({
        reference: t.String(),
        status: t.Literal('success'),
        transactionRef: t.Optional(t.String()),
        amount: t.Optional(t.Number()),
        email: t.Optional(t.String({ format: 'email' })),
        metadata: t.Optional(t.Record(t.String(), t.Unknown())),
      }),
    }
  )

  // POST /payments/retry - Retry failed payment recording
  .post('/retry',
    async ({ userId, body }) => {
      const { reference } = body

      // Check current transaction status
      const { data: transaction } = await supabase
        .from('transactions')
        .select('*')
        .eq('paystack_ref', reference)
        .eq('member_id', userId)
        .single()

      if (!transaction) {
        throw new Error('Transaction not found')
      }

      if (transaction.status === 'success') {
        return {
          success: true,
          alreadyProcessed: true,
          transaction,
        }
      }

      // Record retry attempt
      await recordPaymentAttempt({
        memberId: userId,
        reference,
        status: 'retry',
        metadata: { previous_status: transaction.status },
      })

      // Verify with Paystack
      try {
        const verified = await paystack.verifyTransaction(reference)

        if (verified.status === 'success') {
          const updatedTransaction = await processSuccessfulPayment(reference, verified, userId)
          
          return {
            success: true,
            transaction: {
              id: updatedTransaction.id,
              reference: updatedTransaction.paystack_ref,
              amount: updatedTransaction.amount,
              type: updatedTransaction.type,
              status: updatedTransaction.status,
              created_at: updatedTransaction.created_at,
            },
          }
        } else {
          await processFailedPayment(reference, userId, {
            retry_verification_status: verified.status,
          })

          return {
            success: false,
            status: verified.status,
            message: `Payment status from Paystack: ${verified.status}`,
          }
        }
      } catch (error) {
        throw new Error(`Retry failed: ${(error as Error).message}`)
      }
    },
    {
      body: t.Object({
        reference: t.String(),
      }),
    }
  )

  // POST /payments/cancel - Record cancelled payment
  .post('/cancel',
    async ({ userId, body }) => {
      const { reference } = body

      // Update transaction status
      await supabase
        .from('transactions')
        .update({
          status: 'failed',
          metadata: {
            cancelled_at: new Date().toISOString(),
            cancelled_by: 'user',
          },
        })
        .eq('paystack_ref', reference)
        .eq('member_id', userId)
        .eq('status', 'pending')  // Only update if still pending

      // Record the attempt
      await recordPaymentAttempt({
        memberId: userId,
        reference,
        status: 'cancelled',
      })

      return { 
        success: true, 
        message: 'Payment cancellation recorded',
        reference,
      }
    },
    {
      body: t.Object({
        reference: t.String(),
        metadata: t.Optional(t.Record(t.String(), t.Unknown())),
      }),
    }
  )

  // GET /payments/:ref/status - Check payment status
  .get('/:ref/status',
    async ({ params, userId, query }) => {
      const { force_refresh } = query

      // Check local DB
      const { data: transaction } = await supabase
        .from('transactions')
        .select('*')
        .eq('paystack_ref', params.ref)
        .eq('member_id', userId)
        .maybeSingle()

      if (!transaction) {
        throw new Error('Transaction not found')
      }

      // If already success or not forcing refresh, return cached result
      if (transaction.status === 'success' || !force_refresh) {
        return transaction
      }

      // Verify with Paystack
      try {
        const verified = await paystack.verifyTransaction(params.ref)

        if (verified.status === 'success' && transaction.status !== 'success') {
          // Update to success
          const updated = await processSuccessfulPayment(params.ref, verified, userId)
          return updated
        }

        return {
          ...transaction,
          paystack_status: verified.status,
          last_checked: new Date().toISOString(),
        }
      } catch (error) {
        return {
          ...transaction,
          verification_error: (error as Error).message,
          last_checked: new Date().toISOString(),
        }
      }
    },
    {
      query: t.Object({
        force_refresh: t.Optional(t.Boolean()),
      }),
    }
  )

  // GET /payments/me - Get payment history
  .get('/me',
    async ({ userId, query }) => {
      const { from, to } = paginate(query.page, query.limit)
      const { data, error } = await supabase.from('transactions')
        .select('*')
        .eq('member_id', userId)
        .order('created_at', { ascending: false })
        .range(from, to)
      if (error) throw new Error(error.message)
      return data
    },
    { query: paginationQS }
  )

  // Admin routes
  .use(requireAdmin)
  .get('/',
    async ({ query }) => {
      const { from, to } = paginate(query.page, query.limit)
      const { data, error, count } = await supabase.from('transactions')
        .select('*, profiles(full_name, member_no)', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to)
      if (error) throw new Error(error.message)
      return { data, total: count }
    },
    { query: paginationQS }
  )

// Webhook handler - processes Paystack webhooks as backup
export const webhookHandler = new Elysia()
  .use(validateWebhook)
  .post('/payments/webhook',
    async ({ webhookPayload }) => {
      const { event, data } = webhookPayload

      if (event === 'charge.success') {
        const { reference, amount, channel, metadata } = data
        const memberId = metadata?.member_id

        if (!memberId) {
          console.error('Webhook missing member_id in metadata')
          return { received: true, error: 'Missing member_id' }
        }

        // Check if already processed by callback
        const { data: existing } = await supabase
          .from('transactions')
          .select('status')
          .eq('paystack_ref', reference)
          .single()

        if (existing?.status === 'success') {
          return { received: true, already_processed: true }
        }

        // Process via webhook
        try {
          const verified = await paystack.verifyTransaction(reference)
          await processSuccessfulPayment(reference, verified, memberId)
          return { received: true, processed: true }
        } catch (error) {
          console.error('Webhook processing error:', error)
          return { received: true, error: (error as Error).message }
        }
      }

      if (event === 'transfer.success') {
        await supabase.from('dividends')
          .update({ status: 'success' })
          .eq('paystack_transfer_ref', data.transfer_code)
        return { received: true }
      }

      if (event === 'transfer.failed') {
        await supabase.from('dividends')
          .update({ status: 'failed' })
          .eq('paystack_transfer_ref', data.transfer_code)
        return { received: true }
      }

      return { received: true }
    }
  )
