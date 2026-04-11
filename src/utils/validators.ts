import { t } from 'elysia'

export const uuidParam    = t.Object({ id: t.String({ format: 'uuid' }) })
export const paginationQS = t.Object({
  page:  t.Optional(t.Numeric({ minimum: 1, default: 1 })),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 20 })),
})

export function paginate(page = 1, limit = 20) {
  const from = (page - 1) * limit
  return { from, to: from + limit - 1 }
}
