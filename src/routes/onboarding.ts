import Elysia, { t }    from 'elysia'
import { authenticate } from '../middleware/authenticate'
import { supabase }     from '../lib/supabase'

export const onboardingRoutes = new Elysia({ prefix: '/onboarding' })
  .use(authenticate)

  // All onboarding screens → GET /onboarding/status
  // Returns current step so the client knows which step screen to render
  .get('/status', async ({ userId }) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('onboarding_step, onboarding_done, full_name, phone, address, bank_name, bank_account, avatar_url')
      .eq('id', userId)
      .single()
    if (error) throw new Error('Profile not found')
    return data
  })

  // step-1.tsx → PATCH /onboarding/step-1 — personal info confirmation
  .patch('/step-1',
    async ({ userId, body }) => {
      const { data, error } = await supabase.from('profiles')
        .update({
          full_name:      body.full_name,
          phone:          body.phone,
          address:        body.address,
          onboarding_step: 1,
          updated_at:     new Date().toISOString(),
        })
        .eq('id', userId).select('onboarding_step').single()
      if (error) throw new Error(error.message)
      return data
    },
    {
      body: t.Object({
        full_name: t.String({ minLength: 2 }),
        phone:     t.String(),
        address:   t.String(),
      }),
    }
  )

  // step-2.tsx → PATCH /onboarding/step-2 — bank details
  .patch('/step-2',
    async ({ userId, body }) => {
      const { data, error } = await supabase.from('profiles')
        .update({
          bank_name:       body.bank_name,
          bank_account:    body.bank_account,
          bank_code:       body.bank_code,
          onboarding_step: 2,
          updated_at:      new Date().toISOString(),
        })
        .eq('id', userId).select('onboarding_step').single()
      if (error) throw new Error(error.message)
      return data
    },
    {
      body: t.Object({
        bank_name:    t.String(),
        bank_account: t.String(),
        bank_code:    t.String(),
      }),
    }
  )

  // step-3.tsx → PATCH /onboarding/step-3 — profile photo + complete
  .patch('/step-3',
    async ({ userId, body }) => {
      const { data, error } = await supabase.from('profiles')
        .update({
          avatar_url:      body.avatar_url ?? null,
          next_of_kin:     body.next_of_kin ?? null,
          onboarding_step: 3,
          onboarding_done: true,
          updated_at:      new Date().toISOString(),
        })
        .eq('id', userId).select('onboarding_step, onboarding_done').single()
      if (error) throw new Error(error.message)
      // Force Supabase to refresh the JWT claims so the next request
      // includes onboarding_done: true — client should call /auth/refresh after this
      return { ...data, message: 'Onboarding complete. Refresh your token.' }
    },
    {
      body: t.Partial(t.Object({
        avatar_url:  t.String(),
        next_of_kin: t.String(),
      })),
    }
  )
