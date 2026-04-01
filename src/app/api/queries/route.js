import { NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth'
import { getQueries } from '@/lib/kv'

export async function GET(req) {
  const { session, error, status } = await requireSession()
  if (error) return NextResponse.json({ error }, { status })

  const { searchParams } = new URL(req.url)
  const page = parseInt(searchParams.get('page') || '0')

  const queries = await getQueries(session.role, session.email, page)
  return NextResponse.json(queries)
}
