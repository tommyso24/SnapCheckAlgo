import { requireSession } from '@/lib/auth'
import { getGlobalSettings, getUserSettings, saveQuery } from '@/lib/kv'

export const maxDuration = 60

export async function POST(req) {
  const { session, error, status } = await requireSession()
  if (error) return new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json' } })

  let body
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: '请求格式错误' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  const { url, inquiry } = body
  if (!url?.trim() && !inquiry?.trim()) {
    return new Response(JSON.stringify({ error: '请至少填写公司网址或询盘信息' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  // Admin uses global settings for all fields; regular user uses global baseUrl/prompt + own apiKey/modelName
  const globalSettings = await getGlobalSettings()
  const userSettings = await getUserSettings(session.email)

  const baseUrl = globalSettings.baseUrl?.trim()
  const systemPrompt = globalSettings.systemPrompt || ''
  const apiKey = userSettings.apiKey?.trim()
  const modelName = userSettings.modelName?.trim() || 'gemini-2.0-flash'

  if (!baseUrl) {
    return new Response(JSON.stringify({ error: '管理员尚未配置 Base URL，请联系管理员' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
  }
  if (!apiKey) {
    return new Response(JSON.stringify({ error: '请先在设置中填写您的 API Key' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  const endpoint = baseUrl.replace(/\/$/, '') + '/chat/completions'
  const userContent = `**公司网址：** ${url || '未提供'}\n\n**询盘详细信息：**\n${inquiry || '未提供'}`

  let upstreamRes
  try {
    upstreamRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelName,
        stream: true,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
      }),
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: `无法连接到 API (${endpoint})：${e.message}` }), { status: 502, headers: { 'Content-Type': 'application/json' } })
  }

  if (!upstreamRes.ok) {
    let errText = ''
    try { errText = await upstreamRes.text() } catch {}
    return new Response(
      JSON.stringify({ error: `API 返回错误 ${upstreamRes.status}：${errText || upstreamRes.statusText}` }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // Stream response back to client, collect full text for saving
  let fullText = ''

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const reader = upstreamRes.body.getReader()
        const decoder = new TextDecoder()

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value, { stream: true })
          controller.enqueue(new TextEncoder().encode(chunk))

          const lines = chunk.split('\n')
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const data = line.slice(6).trim()
            if (data === '[DONE]') continue
            try {
              const parsed = JSON.parse(data)
              fullText += parsed.choices?.[0]?.delta?.content || ''
            } catch {}
          }
        }
      } catch (e) {
        const errMsg = `data: ${JSON.stringify({ error: `流式传输中断：${e.message}` })}\n\n`
        controller.enqueue(new TextEncoder().encode(errMsg))
      } finally {
        controller.close()
      }

      // Save to history
      if (fullText) {
        const riskLevel = fullText.includes('高风险') ? 'high'
          : fullText.includes('中风险') ? 'medium'
          : fullText.includes('低风险') ? 'low' : 'unknown'

        await saveQuery({
          userEmail: session.email,
          url: url?.trim() || '',
          inquiry: inquiry?.trim() || '',
          result: fullText,
          riskLevel,
          createdAt: new Date().toISOString(),
          model: modelName,
        }).catch(console.error)
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
}
