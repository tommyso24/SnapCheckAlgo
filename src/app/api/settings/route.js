import { NextResponse } from 'next/server'
import { requireSession, requireAdmin } from '@/lib/auth'
import { getSettings, saveSettings } from '@/lib/kv'

export async function GET() {
  const { session, error, status } = await requireSession()
  if (error) return NextResponse.json({ error }, { status })

  const settings = await getSettings()

  // Hide API key from non-admins
  if (session.role !== 'admin') {
    return NextResponse.json({
      modelName: settings.modelName,
      hasApiKey: !!settings.apiKey,
    })
  }

  return NextResponse.json(settings)
}

export async function POST(req) {
  const { error, status } = await requireAdmin()
  if (error) return NextResponse.json({ error }, { status })

  const data = await req.json()
  const allowed = ['baseUrl', 'apiKey', 'modelName', 'systemPrompt']
  const filtered = Object.fromEntries(
    Object.entries(data).filter(([k]) => allowed.includes(k))
  )

  await saveSettings(filtered)
  return NextResponse.json({ ok: true })
}
