import { supabase } from '../lib/supabase'
import type { Database } from '../types/database'

type Transaction = Database['public']['Tables']['transactions']['Row']
type TransactionInsert = Database['public']['Tables']['transactions']['Insert']

export interface PaystackVerifyResponse {
  status: string
  message: string
  data: {
    id: number
    domain: string
    status: string
    reference: string
    amount: number
    message: string | null
    gateway_response: string
    paid_at: string
    created_at: string
    channel: string
    currency: string
    ip_address: string
    metadata: Record<string, unknown>
    log: {
      time_spent: number
      attempts: number
      authentication: string
      errors: number
      success: boolean
      mobile: boolean
      input: unknown[]
      channel: string | null
      history: {
        type: string
        message: string
        time: number
      }[]
    }
    fees: number | null
    fees_split: unknown | null
    authorization: {
      authorization_code: string
      bin: string
      last4: string
      exp_month: string
      exp_year: string
      channel: string
      card_type: string
      bank: string
      country_code: string
      brand: string
      reusable: boolean
      signature: string
      account_name: string | null
    }
    customer: {
      id: number
      first_name: string | null
      last_name: string | null
      email: string
      customer_code: string
      phone: string | null
      metadata: Record<string, unknown> | null
      risk_action: string
    }
    plan: unknown | null
    split: unknown
    order_id: string | null
    paidAt: string
    createdAt: string
    requested_amount: number
    source: {
      type: string
      source: string
      entry_point: string
      identifier: string | null
    }
  }
}

export interface PaymentMetadata {
  contribution_id?: string
  loan_id?: string
  member_id: string
  type: 'contribution' | 'loan_repayment' | 'levy'
  [key: string]: unknown
}

export function generatePaystackReference(
  type: 'contribution' | 'loan_repayment' | 'levy',
  memberId: string
): string {
  const timestamp = Date.now()
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0')
  const typePrefix = type === 'contribution' ? 'CONT' : type === 'loan_repayment' ? 'LOAN' : 'LEVY'
  const shortMemberId = memberId.slice(0, 8)
  return `DOMI-${typePrefix}-${shortMemberId}-${timestamp}-${random}`
}

export async function createPendingTransaction(params: {
  reference: string
  memberId: string
  amount: number
  type: 'contribution' | 'loan_repayment' | 'levy'
  metadata: PaymentMetadata
  contributionId?: string
  loanId?: string
}): Promise<Transaction> {
  const { data: transaction, error } = await supabase
    .from('transactions')
    .insert({
      paystack_ref: params.reference,
      member_id: params.memberId,
      amount: params.amount,
      type: params.type,
      status: 'pending',
      contribution_id: params.contributionId || null,
      loan_id: params.loanId || null,
      metadata: {
        ...params.metadata,
        initiated_at: new Date().toISOString(),
      },
    })
    .select()
    .single()

  if (error) {
    throw new Error(`Failed to create pending transaction: ${error.message}`)
  }

  return transaction
}

export async function processSuccessfulPayment(
  reference: string,
  verified: PaystackVerifyResponse['data'],
  memberId: string
): Promise<Transaction> {
  const { amount, channel, metadata: paystackMetadata } = verified

  // Extract metadata we sent to Paystack
  const metadata = paystackMetadata as PaymentMetadata

  // 1. Update transaction to success
  const { data: transaction, error: txError } = await supabase
    .from('transactions')
    .update({
      status: 'success',
      channel,
      metadata: {
        ...metadata,
        paystack_response: verified,
        verified_at: new Date().toISOString(),
      },
    })
    .eq('paystack_ref', reference)
    .eq('member_id', memberId)
    .select()
    .single()

  if (txError) {
    throw new Error(`Failed to update transaction: ${txError.message}`)
  }

  if (!transaction) {
    throw new Error('Transaction not found or does not belong to member')
  }

  // 2. Update contribution if applicable
  if (transaction.contribution_id) {
    await supabase
      .from('contributions')
      .update({
        status: 'verified',
        payment_ref: reference,
        updated_at: new Date().toISOString(),
      })
      .eq('id', transaction.contribution_id)
      .eq('member_id', memberId)
  }

  // 3. Update loan if applicable
  if (transaction.loan_id) {
    const { data: loan } = await supabase
      .from('loans')
      .select('balance')
      .eq('id', transaction.loan_id)
      .eq('member_id', memberId)
      .single()

    if (loan) {
      const newBalance = Math.max(0, Number(loan.balance) - amount / 100)
      await supabase
        .from('loans')
        .update({
          balance: newBalance,
          status: newBalance === 0 ? 'closed' : 'repaying',
          updated_at: new Date().toISOString(),
        })
        .eq('id', transaction.loan_id)
    }
  }

  // 4. Create notification
  await supabase.from('notifications').insert({
    member_id: memberId,
    title: transaction.type === 'loan_repayment'
      ? 'Loan Repayment Successful'
      : transaction.type === 'contribution'
      ? 'Contribution Payment Received'
      : 'Payment Received',
    body: `₦${(amount / 100).toLocaleString()} has been processed successfully.`,
    type: 'payment',
    data: {
      transaction_id: transaction.id,
      reference: reference,
      amount: amount / 100,
    },
  })

  return transaction
}

export async function processFailedPayment(
  reference: string,
  memberId: string,
  errorData?: Record<string, unknown>
): Promise<void> {
  await supabase
    .from('transactions')
    .update({
      status: 'failed',
      metadata: {
        failed_at: new Date().toISOString(),
        error: errorData,
      },
    })
    .eq('paystack_ref', reference)
    .eq('member_id', memberId)
}

export async function getPendingTransaction(
  reference: string,
  memberId: string
): Promise<Transaction | null> {
  const { data } = await supabase
    .from('transactions')
    .select('*')
    .eq('paystack_ref', reference)
    .eq('member_id', memberId)
    .eq('status', 'pending')
    .maybeSingle()

  return data
}

export async function recordPaymentAttempt(params: {
  memberId: string
  reference: string
  status: 'initiated' | 'success' | 'cancelled' | 'failed' | 'retry'
  errorMessage?: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  await supabase.from('payment_attempts').insert({
    member_id: params.memberId,
    paystack_ref: params.reference,
    status: params.status,
    error_message: params.errorMessage || null,
    metadata: params.metadata || {},
  })
}
