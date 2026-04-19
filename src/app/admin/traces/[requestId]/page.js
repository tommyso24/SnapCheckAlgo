'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'

function statusColor(status) {
  if (status === 'success') return 'bg-stripe-success/15 text-stripe-successText border-stripe-success/40'
  if (status === 'error')   return 'bg-stripe-ruby/15 text-stripe-ruby border-stripe-ruby/40'
  if (status === 'running') return 'bg-stripe-lemon/15 text-stripe-lemon border-stripe-lemon/40'
  return 'bg-stripe-border text-stripe-body border-stripe-border'
}

function eventColor(level) {
  if (level === 'error') return 'border-l-stripe-ruby'
  if (level === 'warn')  return 'border-l-stripe-lemon'
  return 'border-l-stripe-purple'
}

function groupEvents(events) {
  const groups = []
  let cur = null
  for (const e of events) {
    if (!cur || cur.tag !== e.tag) {
      cur = { tag: e.tag, events: [e] }
      groups.push(cur)
    } else {
      cur.events.push(e)
    }
  }
  return groups.map(g => ({
    tag: g.tag,
    events: g.events,
    durationMs: g.events.length > 1 ? g.events[g.events.length - 1].ts - g.events[0].ts : 0,
    level: g.events.some(e => e.level === 'error') ? 'error'
         : g.events.some(e => e.level === 'warn')  ? 'warn'
         : 'info',
  }))
}

export default function TraceDetailPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const requestId = params.requestId
  const date = searchParams.get('date') || undefined

  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [openTags, setOpenTags] = useState({})

  useEffect(() => {
    let cancelled = false
    async function run() {
      setLoading(true)
      try {
        const params = date ? `?date=${date}` : ''
        const r = await fetch(`/api/admin/trace/${requestId}${params}`)
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const body = await r.json()
        if (!body.ok) throw new Error(body.error || 'unknown error')
        if (!cancelled) setData(body.data)
      } catch (e) {
        if (!cancelled) setError(e.message || String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [requestId, date])

  const groups = useMemo(() => groupEvents(data?.events || []), [data])
  const llmResponseEvent = useMemo(() => (data?.events || []).find(e => e.event === 'llm_response'), [data])

  if (loading) return <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-12 text-center text-stripe-body">加载中…</div>
  if (error) return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6">
      <Link href="/admin/traces" className="text-link text-stripe-purple">← 返回列表</Link>
      <div className="mt-4 px-4 py-2 bg-stripe-ruby/10 text-stripe-ruby border border-stripe-ruby/30 rounded-stripe text-caption">{error}</div>
    </div>
  )
  if (!data) return null

  const { meta } = data
  const images = meta.inquiryImages || []

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6">
      <div className="mb-4 flex items-center gap-3 text-caption">
        <Link href="/admin/traces" className="text-stripe-purple hover:underline">← 返回列表</Link>
        <span className="text-stripe-body">/</span>
        <span className="font-mono">{requestId}</span>
      </div>

      <div className="mb-6 p-4 border border-stripe-border rounded-stripe bg-white">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-caption">
          <Field label="status">
            <span className={`inline-block px-2 py-0.5 rounded-stripe-sm border text-caption-sm ${statusColor(meta.status)}`}>{meta.status}</span>
          </Field>
          <Field label="route">{meta.route || '-'}</Field>
          <Field label="时长 ms">{meta.durationMs || '-'}</Field>
          <Field label="riskLevel">{meta.riskLevel || '-'}</Field>
          <Field label="model">{meta.model || '-'}</Field>
          <Field label="tokens">{meta.tokens ? `${meta.tokens.prompt}/${meta.tokens.completion}` : '-'}</Field>
          <Field label="caller">{meta.caller || '-'}</Field>
          <Field label="errorCode">{meta.errorCode || '-'}</Field>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr_360px] gap-4">
        {/* Left: inputs */}
        <div className="space-y-4">
          <Card title="询盘原文">
            <pre className="whitespace-pre-wrap break-words text-caption-sm font-mono text-stripe-navy">{meta.inquiryText || '(空)'}</pre>
          </Card>
          <Card title="Company Profile">
            <pre className="whitespace-pre-wrap break-words text-caption-sm font-mono text-stripe-navy max-h-64 overflow-auto">{meta.companyProfile || '(空)'}</pre>
          </Card>
          <Card title={`图片 (${images.length})`}>
            {images.length === 0 && <div className="text-stripe-body text-caption">(无)</div>}
            {images.map((img, i) => (
              <div key={i} className="mb-3 pb-3 border-b border-stripe-border last:border-0">
                <div className="text-caption-sm text-stripe-body mb-1">
                  {img.type} · {img.size} B · {img.truncated ? '截断' : '完整'}
                </div>
                {img.base64 && !img.truncated && (
                  <img src={`data:${img.type};base64,${img.base64}`} alt="" className="max-w-full rounded-stripe-sm border border-stripe-border" />
                )}
                {img.url && (
                  <a href={img.url} target="_blank" rel="noopener noreferrer" className="text-link text-stripe-purple break-all">{img.url}</a>
                )}
                {img.truncated && (
                  <div className="text-caption-sm font-mono text-stripe-body">sha256: {img.sha256?.slice(0, 16)}…</div>
                )}
              </div>
            ))}
          </Card>
        </div>

        {/* Middle: timeline */}
        <div>
          <div className="mb-3 flex items-center gap-2">
            <button type="button" onClick={() => setOpenTags(Object.fromEntries(groups.map((g, gi) => [`${g.tag}_${gi}`, true])))} className="h-8 px-3 text-caption-sm border border-stripe-border rounded-stripe-sm hover:bg-stripe-purpleLight/10">全部展开</button>
            <button type="button" onClick={() => setOpenTags({})} className="h-8 px-3 text-caption-sm border border-stripe-border rounded-stripe-sm hover:bg-stripe-purpleLight/10">全部折叠</button>
          </div>
          <div className="space-y-2">
            {groups.map((g, gi) => {
              const isOpen = !!openTags[`${g.tag}_${gi}`]
              return (
                <div key={gi} className={`border border-stripe-border border-l-4 ${eventColor(g.level)} rounded-stripe bg-white`}>
                  <button
                    type="button"
                    onClick={() => setOpenTags({ ...openTags, [`${g.tag}_${gi}`]: !isOpen })}
                    className="w-full text-left px-3 py-2 flex items-center justify-between hover:bg-stripe-purpleLight/10"
                  >
                    <span className="font-mono text-caption text-stripe-navy">{g.tag}</span>
                    <span className="flex items-center gap-3 text-caption-sm text-stripe-body">
                      <span>{g.events.length} events</span>
                      {g.durationMs > 0 && <span className="font-mono">{g.durationMs} ms</span>}
                      <span>{isOpen ? '▾' : '▸'}</span>
                    </span>
                  </button>
                  {isOpen && (
                    <div className="border-t border-stripe-border">
                      {g.events.map((e, ei) => (
                        <div key={ei} className="px-3 py-2 border-b border-stripe-border last:border-0">
                          <div className="flex items-center gap-3 text-caption-sm mb-1">
                            <span className="font-mono text-stripe-navy">{e.event}</span>
                            <span className="text-stripe-body">seq {e.seq}</span>
                            <span className="text-stripe-body ml-auto">{e.payloadSize} B{e.truncated ? ' (截断)' : ''}</span>
                          </div>
                          <pre className="whitespace-pre-wrap break-words text-caption-sm font-mono bg-stripe-border/20 p-2 rounded-stripe-sm max-h-80 overflow-auto">
                            {JSON.stringify(e.payload, null, 2)}
                          </pre>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
            {groups.length === 0 && <div className="text-stripe-body text-caption py-8 text-center">(没有节点事件)</div>}
          </div>
        </div>

        {/* Right: final LLM report */}
        <div>
          <Card title="LLM 最终输出">
            {llmResponseEvent ? (
              <>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(llmResponseEvent.payload?.content || '')}
                  className="mb-2 h-7 px-2 text-caption-sm border border-stripe-border rounded-stripe-sm hover:bg-stripe-purpleLight/10"
                >
                  复制
                </button>
                <pre className="whitespace-pre-wrap break-words text-caption-sm font-mono text-stripe-navy max-h-[600px] overflow-auto">
                  {llmResponseEvent.payload?.content || '(空)'}
                </pre>
              </>
            ) : (
              <div className="text-stripe-body text-caption">(未找到 llm_response 事件)</div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

function Card({ title, children }) {
  return (
    <div className="border border-stripe-border rounded-stripe bg-white">
      <div className="px-3 py-2 border-b border-stripe-border text-caption font-normal text-stripe-navy">{title}</div>
      <div className="p-3">{children}</div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <div className="text-caption-sm text-stripe-body mb-0.5">{label}</div>
      <div className="font-mono text-caption text-stripe-navy">{children}</div>
    </div>
  )
}
