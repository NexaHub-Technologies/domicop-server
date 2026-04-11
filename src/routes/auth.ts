import Elysia, { t }            from 'elysia'
import { supabaseAuth, supabase } from '../lib/supabase'
import { authenticate }          from '../middleware/authenticate'
import { authRateLimit }         from '../middleware/rateLimiter'

export const authRoutes = new Elysia({ prefix: '/auth' })
  .use(authRateLimit)

  // sign-in.tsx → POST /auth/login
  .post('/login',
    async ({ body, set }) => {
      const { data, error } = await supabaseAuth.auth.signInWithPassword({
        email: body.email, password: body.password,
      })
      if (error) { set.status = 401; throw new Error(error.message) }
      return {
        access_token:   data.session!.access_token,
        refresh_token:  data.session!.refresh_token,
        expires_in:     data.session!.expires_in,
        user: {
          id:             data.user!.id,
          email:          data.user!.email,
          role:           data.user!.app_metadata?.user_role ?? 'member',
          // Client uses this to decide: go to (onboarding) or (tabs)
          onboarding_done: data.user!.app_metadata?.onboarding_done ?? false,
        },
      }
    },
    { body: t.Object({ email: t.String({ format: 'email' }), password: t.String({ minLength: 6 }) }) }
  )

  .post('/refresh',
    async ({ body, set }) => {
      const { data, error } = await supabaseAuth.auth.refreshSession({ refresh_token: body.refresh_token })
      if (error) { set.status = 401; throw new Error(error.message) }
      return {
        access_token:  data.session!.access_token,
        refresh_token: data.session!.refresh_token,
        expires_in:    data.session!.expires_in,
      }
    },
    { body: t.Object({ refresh_token: t.String() }) }
  )

  .post('/logout',
    async ({ headers }) => {
      const token = headers['authorization']?.replace('Bearer ', '')
      if (token) await supabaseAuth.auth.admin.signOut(token)
      return { success: true }
    }
  )

  // forgot-password.tsx → POST /auth/reset-password
  .post('/reset-password',
    async ({ body }) => {
      await supabaseAuth.auth.resetPasswordForEmail(body.email, {
        redirectTo: `${process.env.API_BASE_URL}/auth/confirm-reset`,
      })
      // Always return success — never leak whether email exists
      return { message: 'If that email is registered, a reset link has been sent.' }
    },
    { body: t.Object({ email: t.String({ format: 'email' }) }) }
  )

  // reset-password.tsx → POST /auth/confirm-reset
  .post('/confirm-reset',
    async ({ body, set }) => {
      const { error } = await supabaseAuth.auth.updateUser({ password: body.password })
      if (error) { set.status = 400; throw new Error(error.message) }
      return { success: true }
    },
    { body: t.Object({ password: t.String({ minLength: 8 }) }) }
  )

  // change-password.tsx → POST /auth/change-password (authenticated)
  .use(authenticate)
  .post('/change-password',
    async ({ body, set }) => {
      const { error } = await supabaseAuth.auth.updateUser({ password: body.new_password })
      if (error) { set.status = 400; throw new Error(error.message) }
      return { success: true }
    },
    {
      body: t.Object({
        current_password: t.String({ minLength: 6 }),
        new_password:     t.String({ minLength: 8 }),
      }),
    }
  )

  // Store FCM token after login (call from mobile app on every login)
  .post('/fcm-token',
    async ({ userId, body }) => {
      await supabase.from('profiles').update({ fcm_token: body.fcm_token }).eq('id', userId)
      return { success: true }
    },
    { body: t.Object({ fcm_token: t.String() }) }
  )
