import { supabase } from '../lib/supabase'

export async function writeAuditLog(payload: {
  actor_id:   string
  action:     string
  entity:     string
  entity_id?: string
  metadata?:  Record<string, unknown>
}) {
  await supabase.from('audit_log').insert({
    actor_id:  payload.actor_id,
    action:    payload.action,
    entity:    payload.entity,
    entity_id: payload.entity_id ?? null,
    metadata:  payload.metadata  ?? {},
  })
}
