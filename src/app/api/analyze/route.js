import { requireSession } from '@/lib/auth'
import { getSettings, saveQuery } from '@/lib/kv'

export async function POST(req) {
  const { session, error, status } = await requireSession()
  if (error) return new Response(JSON.stringify({ error }), { status })

  const { url, inquiry } = await req.json()
  if (!url?.trim() && !inquiry?.trim()) {
    return new Response(JSON.stringify({ error: '请至少填写公司网址或询盘信息' }), { status: 400 })
  }

  const settings = await getSettings()
  if (!settings.baseUrl || !settings.apiKey) {
    return new Response(JSON.stringify({ error: '管理员尚未配置 API，请联系管理员' }), { status: 503 })
  }

  const userContent = `**公司网址：** ${url || '未提供'}\n\n**询盘详细信息：**\n${inquiry || '未提供'}`

  const endpoint = settings.baseUrl.replace(/\/$/, '') + '/chat/completions'

  let upstreamRes
  try {
    upstreamRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.modelName || 'gemini-2.0-flash',
        stream: true,
        messages: [
          { role: 'system', content: settings.systemPrompt || '' },
          { role: 'user', content: userContent },
        ],
      }),
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: `无法连接到 API：${e.message}` }), { status: 502 })
  }

  if (!upstreamRes.ok) {
    const errText = await upstreamRes.text()
    return new Response(JSON.stringify({ error: `上游 API 错误 ${upstreamRes.status}: ${errText}` }), { status: 502 })
  }

  // Collect full response while streaming to client
  let fullText = ''

  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstreamRes.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)
        controller.enqueue(new TextEncoder().encode(chunk))

        // Extract text from SSE for saving
        const lines = chunk.split('\n').filter(l => l.startsWith('data: '))
        for (const line of lines) {
          const data = line.slice(6)
          if (data === '[DONE]') continue
          try {
            const parsed = JSON.parse(data)
            fullText += parsed.choices?.[0]?.delta?.content || ''
          } catch {}
        }
      }

      controller.close()

      // Save query after streaming done
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
        model: settings.modelName,
      }).catch(console.error)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
