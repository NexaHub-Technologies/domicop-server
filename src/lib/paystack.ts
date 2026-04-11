const BASE   = 'https://api.paystack.co'
const SECRET = process.env.PAYSTACK_SECRET_KEY!

async function paystackRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res  = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json', ...options.headers },
  })
  const json = await res.json() as { status: boolean; message: string; data: T }
  if (!json.status) throw new Error(json.message)
  return json.data
}

export const paystack = {
  initializeTransaction: (payload: {
    email: string; amount: number; metadata?: Record<string, unknown>; callback_url?: string
  }) => paystackRequest<{ authorization_url: string; reference: string; access_code: string }>(
    '/transaction/initialize',
    { method: 'POST', body: JSON.stringify({ ...payload, amount: payload.amount * 100 }) }
  ),

  verifyTransaction: (reference: string) =>
    paystackRequest<{ status: string; amount: number; metadata: Record<string, unknown> }>(
      `/transaction/verify/${reference}`
    ),

  createTransferRecipient: (payload: { name: string; account_number: string; bank_code: string }) =>
    paystackRequest<{ recipient_code: string }>(
      '/transferrecipient',
      { method: 'POST', body: JSON.stringify({ type: 'nuban', currency: 'NGN', ...payload }) }
    ),

  initiateTransfer: (payload: { amount: number; recipient: string; reason?: string }) =>
    paystackRequest<{ transfer_code: string; status: string }>(
      '/transfer',
      { method: 'POST', body: JSON.stringify({ source: 'balance', currency: 'NGN', ...payload, amount: payload.amount * 100 }) }
    ),
}
