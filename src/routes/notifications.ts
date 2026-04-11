import Elysia, { t }    from 'elysia'
import { authenticate } from '../middleware/authenticate'
import { requireAdmin } from '../middleware/requireAdmin'
import { supabase }     from '../lib/supabase'
import { fcm }          from '../lib/fcm'

export const notificationRoutes = new Elysia({ prefix: '/notifications' })
  .use(authenticate)

  // notifications/index.tsx → GET /notifications/me
  .get('/me',
    async ({ userId, query }) => {
      let q = supabase.from('notifications')
        .select('*').eq('member_id', userId).order('created_at', { ascending: false }).limit(50)
      if (query.unread_only) q = q.eq('read', false)
      const { data, error } = await q
      if (error) throw new Error(error.message)

      const unread_count = data?.filter(n => !n.read).length ?? 0
      return { notifications: data, unread_count }
    },
    { query: t.Partial(t.Object({ unread_only: t.Boolean() })) }
  )

  // Mark notification(s) as read
  .patch('/me/read',
    async ({ userId, body }) => {
      let q = supabase.from('notifications').update({ read: true }).eq('member_id', userId)
      if (body.id) q = q.eq('id', body.id)
      // If no id provided, mark all as read
      await q
      return { success: true }
    },
    { body: t.Partial(t.Object({ id: t.String() })) }
  )

  // Admin broadcast — also persists to notifications table for member inbox
  .use(requireAdmin)
  .post('/broadcast',
    async ({ body }) => {
      // Fetch active members with FCM tokens
      const { data: members } = await supabase
        .from('profiles').select('id, fcm_token').eq('status', 'active')
        .not('fcm_token', 'is', null)

      const targets = body.member_ids?.length
        ? members?.filter(m => body.member_ids!.includes(m.id))
        : members

      // Persist notification to DB for each member
      if (targets?.length) {
        await supabase.from('notifications').insert(
          targets.map(m => ({
            member_id: m.id,
            title:     body.title,
            body:      body.body,
            type:      body.type ?? 'general',
            data:      body.data ?? {},
          }))
        )
      }

      // Send FCM push
      if (body.member_ids?.length) {
        await Promise.allSettled(
          (targets ?? []).map(m =>
            fcm.sendToDevice({ token: m.fcm_token!, title: body.title, body: body.body, data: body.data })
          )
        )
      } else {
        await fcm.sendToTopic({ topic: 'all-members', title: body.title, body: body.body, data: body.data })
      }

      return { sent: targets?.length ?? 'all' }
    },
    {
      body: t.Object({
        title:      t.String(),
        body:       t.String(),
        type:       t.Optional(t.Union([t.Literal('payment'), t.Literal('loan'), t.Literal('announcement'), t.Literal('message'), t.Literal('general')])),
        member_ids: t.Optional(t.Array(t.String())),
        data:       t.Optional(t.Record(t.String(), t.String())),
      }),
    }
  )
