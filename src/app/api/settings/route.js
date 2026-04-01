import { NextResponse } from 'next/server'
import { requireSession, requireAdmin } from '@/lib/auth'
import { getGlobalSettings, saveGlobalSettings, getUserSettings, saveUserSettings } from '@/lib/kv'

// GET: admin gets global settings; user gets their own apiKey/modelName
export async function GET() {
  const { session, error, status } = await requireSession()
  if (error) return NextResponse.json({ error }, { status })

  if (session.role === 'admin') {
    const global = await getGlobalSettings()
    const userOwn = await getUserSettings(session.email)
    return NextResponse.json({ ...global, ...userOwn, role: 'admin' })
  } else {
    const userOwn = await getUserSettings(session.email)
    return NextResponse.json({ ...userOwn, role: 'user' })
  }
}

// POST: admin saves baseUrl/systemPrompt (global) + own apiKey/modelName
//       user saves only their own apiKey/modelName
export async function POST(req) {
  const { session, error, status } = await requireSession()
  if (error) return NextResponse.json({ error }, { status })

  const data = await req.json()

  if (session.role === 'admin') {
    await saveGlobalSettings({ baseUrl: data.baseUrl, systemPrompt: data.systemPrompt })
    await saveUserSettings(session.email, { apiKey: data.apiKey, modelName: data.modelName })
  } else {
    await saveUserSettings(session.email, { apiKey: data.apiKey, modelName: data.modelName })
  }

  return NextResponse.json({ ok: true })
}
