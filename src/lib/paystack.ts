const BASE = "https://api.paystack.co";
const SECRET = process.env.PAYSTACK_SECRET_KEY!;

export interface PaystackInitializeResponse {
  authorization_url: string;
  access_code: string;
  reference: string;
}

export interface PaystackVerifyResponse {
  status: string;
  message: string;
  data: {
    id: number;
    domain: string;
    status: string;
    reference: string;
    amount: number;
    message: string | null;
    gateway_response: string;
    paid_at: string;
    created_at: string;
    channel: string;
    currency: string;
    ip_address: string;
    metadata: Record<string, unknown>;
    log: {
      time_spent: number;
      attempts: number;
      authentication: string;
      errors: number;
      success: boolean;
      mobile: boolean;
      input: unknown[];
      channel: string | null;
      history: {
        type: string;
        message: string;
        time: number;
      }[];
    };
    fees: number | null;
    fees_split: unknown | null;
    authorization: {
      authorization_code: string;
      bin: string;
      last4: string;
      exp_month: string;
      exp_year: string;
      channel: string;
      card_type: string;
      bank: string;
      country_code: string;
      brand: string;
      reusable: boolean;
      signature: string;
      account_name: string | null;
    };
    customer: {
      id: number;
      first_name: string | null;
      last_name: string | null;
      email: string;
      customer_code: string;
      phone: string | null;
      metadata: Record<string, unknown> | null;
      risk_action: string;
    };
    plan: unknown | null;
    split: unknown;
    order_id: string | null;
    paidAt: string;
    createdAt: string;
    requested_amount: number;
    source: {
      type: string;
      source: string;
      entry_point: string;
      identifier: string | null;
    };
  };
}

async function paystackRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${SECRET}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const json = (await res.json()) as { status: boolean; message: string; data: T };
  if (!json.status) throw new Error(json.message);
  return json.data;
}

export const paystack = {
  initializeTransaction: (payload: {
    email: string;
    amount: number;
    reference: string;
    metadata?: Record<string, unknown>;
    callback_url?: string;
  }): Promise<PaystackInitializeResponse> =>
    paystackRequest<PaystackInitializeResponse>("/transaction/initialize", {
      method: "POST",
      body: JSON.stringify({
        ...payload,
        amount: payload.amount * 100, // Convert to kobo
      }),
    }),

  verifyTransaction: (reference: string): Promise<PaystackVerifyResponse["data"]> =>
    paystackRequest<PaystackVerifyResponse["data"]>(`/transaction/verify/${reference}`),

  createTransferRecipient: (payload: {
    name: string;
    account_number: string;
    bank_code: string;
  }) =>
    paystackRequest<{ recipient_code: string }>("/transferrecipient", {
      method: "POST",
      body: JSON.stringify({ type: "nuban", currency: "NGN", ...payload }),
    }),

  initiateTransfer: (payload: { amount: number; recipient: string; reason?: string }) =>
    paystackRequest<{ transfer_code: string; status: string }>("/transfer", {
      method: "POST",
      body: JSON.stringify({
        source: "balance",
        currency: "NGN",
        ...payload,
        amount: payload.amount * 100,
      }),
    }),
};
