export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth'
import { getQueryById } from '@/lib/kv'

export async function GET(req, { params }) {
  const { session, error, status } = await requireSession()
  if (error) return NextResponse.json({ error }, { status })

  const record = await getQueryById(params.id, session.role, session.email)
  if (!record) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json(record)
}
