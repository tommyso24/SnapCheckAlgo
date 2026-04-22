export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'SnapCheck Debug · 诊断报告',
}

// Self-contained HTML report. Light theme matching admin area.
// Content is static and fully controlled; dangerouslySetInnerHTML is safe here.
const REPORT_HTML = `
<style>
  .diag-root { color: #3a3a5c; font-size: 14px; line-height: 1.65; padding: 32px 40px 80px; max-width: 1280px; margin: 0 auto; }
  .diag-root * { box-sizing: border-box; }
  .diag-root h1 { font-size: 26px; color: #1a1a3d; margin: 0 0 8px; font-weight: 500; letter-spacing: -0.01em; }
  .diag-root .meta { display: flex; gap: 16px; flex-wrap: wrap; font-size: 13px; color: #6b7394; padding-bottom: 20px; border-bottom: 1px solid #e5e7ef; margin-bottom: 32px; }
  .diag-root .intro { background: #f7f8fc; border: 1px solid #e5e7ef; border-radius: 8px; padding: 16px 20px; margin-bottom: 32px; font-size: 13.5px; color: #4a5070; }
  .diag-root .intro strong { color: #1a1a3d; }
  .diag-root h2 { font-size: 20px; color: #1a1a3d; margin: 56px 0 18px; padding-bottom: 8px; border-bottom: 1px solid #e5e7ef; font-weight: 500; }
  .diag-root h2 .num { color: #635bff; margin-right: 8px; font-weight: 400; }
  .diag-root h3 { font-size: 15px; color: #1a1a3d; margin: 24px 0 10px; font-weight: 600; }
  .diag-root p { margin: 0 0 12px; }
  .diag-root code { font-family: "SF Mono", Monaco, Menlo, Consolas, monospace; background: #f1f2f7; border: 1px solid #e5e7ef; border-radius: 3px; padding: 1px 6px; font-size: 12.5px; color: #635bff; }
  .diag-root pre { background: #f7f8fc; border: 1px solid #e5e7ef; border-radius: 6px; padding: 12px 14px; overflow-x: auto; font-size: 12.5px; margin: 8px 0; color: #3a3a5c; }
  .diag-root pre code { background: transparent; border: none; padding: 0; color: inherit; }
  .diag-root .kw { color: #d14b7f; }
  .diag-root .str { color: #1a7f37; }
  .diag-root .cmt { color: #8b949e; font-style: italic; }
  .diag-root a { color: #635bff; text-decoration: none; }
  .diag-root a:hover { text-decoration: underline; }

  .diag-root .toc { background: #f7f8fc; border: 1px solid #e5e7ef; border-radius: 8px; padding: 16px 22px; margin-bottom: 32px; }
  .diag-root .toc h3 { margin: 0 0 8px; font-size: 11px; color: #6b7394; text-transform: uppercase; letter-spacing: 0.6px; font-weight: 600; }
  .diag-root .toc ol { margin: 0; padding-left: 22px; }
  .diag-root .toc li { margin: 5px 0; }

  .diag-root .contract-box { background: #f7f8fc; border: 1px solid #e5e7ef; border-left: 3px solid #635bff; border-radius: 8px; padding: 16px 20px; margin: 16px 0 24px; }
  .diag-root .contract-box .label { font-size: 11px; color: #635bff; text-transform: uppercase; letter-spacing: 0.6px; font-weight: 600; margin-bottom: 10px; }

  .diag-root .pipeline { margin-top: 16px; }
  .diag-root .stage { background: #fff; border: 1px solid #e5e7ef; border-left: 4px solid #00a163; border-radius: 8px; padding: 16px 20px; position: relative; }
  .diag-root .stage.has-issue { border-left-color: #bf9500; }
  .diag-root .stage.critical { border-left-color: #df1b41; }
  .diag-root .stage.substage { margin-left: 36px; background: #fafbfe; border-left-width: 3px; }
  .diag-root .stage-header { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 6px; }
  .diag-root .stage-num { font-family: "SF Mono", Monaco, monospace; background: #eeeffd; color: #635bff; border: 1px solid #d9d9f2; padding: 2px 9px; border-radius: 4px; font-size: 12px; font-weight: 600; min-width: 40px; text-align: center; }
  .diag-root .stage-name { font-size: 15px; font-weight: 600; color: #1a1a3d; }
  .diag-root .stage-type { font-size: 10.5px; color: #6b7394; background: #f1f2f7; padding: 2px 8px; border-radius: 10px; text-transform: uppercase; letter-spacing: 0.4px; }
  .diag-root .stage-loc { margin-left: auto; font-family: "SF Mono", Monaco, monospace; font-size: 11.5px; color: #6b7394; }
  .diag-root .stage-body { font-size: 13.5px; margin-top: 6px; color: #4a5070; }
  .diag-root .io-row { display: grid; grid-template-columns: 60px 1fr; gap: 12px; margin: 4px 0; align-items: start; }
  .diag-root .io-label { font-size: 10.5px; color: #6b7394; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; padding-top: 3px; }
  .diag-root .io-content { color: #3a3a5c; }
  .diag-root .io-content code { font-size: 12px; }
  .diag-root .issue-badges { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
  .diag-root .badge { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; padding: 3px 10px; border-radius: 12px; font-weight: 600; border: 1px solid; text-decoration: none !important; font-family: "SF Mono", Monaco, monospace; cursor: pointer; transition: all 0.15s; }
  .diag-root .badge:hover { transform: translateY(-1px); }
  .diag-root .badge.critical { color: #df1b41; border-color: #df1b4155; background: #df1b410a; }
  .diag-root .badge.high { color: #c94c00; border-color: #c94c0055; background: #c94c000a; }
  .diag-root .badge.medium { color: #bf7600; border-color: #bf760055; background: #bf76000a; }
  .diag-root .arrow { height: 22px; margin-left: 40px; border-left: 2px dashed #d9d9f2; position: relative; }
  .diag-root .arrow::after { content: "▼"; color: #d9d9f2; position: absolute; bottom: -6px; left: -8px; font-size: 11px; }

  .diag-root .problem-grid { display: flex; flex-direction: column; gap: 16px; }
  .diag-root .problem-card { background: #fff; border: 1px solid #e5e7ef; border-left: 4px solid; border-radius: 8px; padding: 18px 22px; scroll-margin-top: 80px; }
  .diag-root .problem-card.critical { border-left-color: #df1b41; }
  .diag-root .problem-card.high { border-left-color: #c94c00; }
  .diag-root .problem-card.medium { border-left-color: #bf7600; }
  .diag-root .problem-header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
  .diag-root .problem-id { font-family: "SF Mono", Monaco, monospace; font-size: 13px; font-weight: 700; padding: 2px 10px; border-radius: 4px; }
  .diag-root .problem-card.critical .problem-id { background: #df1b4118; color: #df1b41; }
  .diag-root .problem-card.high .problem-id { background: #c94c0018; color: #c94c00; }
  .diag-root .problem-card.medium .problem-id { background: #bf760018; color: #bf7600; }
  .diag-root .severity-tag { font-size: 10px; padding: 2px 8px; border-radius: 3px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700; }
  .diag-root .severity-tag.critical { background: #df1b41; color: #fff; }
  .diag-root .severity-tag.high { background: #c94c00; color: #fff; }
  .diag-root .severity-tag.medium { background: #e0a42b; color: #fff; }
  .diag-root .problem-title { font-size: 15.5px; font-weight: 600; color: #1a1a3d; flex: 1; }
  .diag-root .problem-steps { font-size: 12px; color: #6b7394; font-family: "SF Mono", Monaco, monospace; }
  .diag-root .problem-body dl { display: grid; grid-template-columns: 110px 1fr; gap: 10px 18px; margin: 12px 0 0; }
  .diag-root .problem-body dt { font-size: 11px; color: #6b7394; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; padding-top: 3px; }
  .diag-root .problem-body dd { margin: 0; font-size: 13.5px; color: #3a3a5c; }
  .diag-root .problem-body dd + dt { border-top: 1px solid #eeeffd; padding-top: 13px; margin-top: 3px; }
  .diag-root .problem-body dd + dt + dd { padding-top: 13px; }

  .diag-root .phase { background: #fff; border: 1px solid #e5e7ef; border-radius: 8px; padding: 18px 22px; margin-bottom: 14px; }
  .diag-root .phase-header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 10px; flex-wrap: wrap; }
  .diag-root .phase-tag { font-family: "SF Mono", Monaco, monospace; font-size: 12px; background: #eeeffd; color: #635bff; border: 1px solid #d9d9f2; padding: 2px 10px; border-radius: 4px; font-weight: 600; }
  .diag-root .phase-name { font-size: 15.5px; font-weight: 600; color: #1a1a3d; }
  .diag-root .phase-covers { font-size: 12px; color: #6b7394; margin-left: auto; }
  .diag-root .phase ol { padding-left: 22px; margin: 8px 0 0; }
  .diag-root .phase li { margin: 6px 0; }

  .diag-root .summary-table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e5e7ef; border-radius: 8px; overflow: hidden; margin: 16px 0; font-size: 13px; }
  .diag-root .summary-table th, .diag-root .summary-table td { padding: 10px 14px; text-align: left; border-bottom: 1px solid #eeeffd; }
  .diag-root .summary-table th { background: #f7f8fc; font-size: 11px; color: #6b7394; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }
  .diag-root .summary-table tr:last-child td { border-bottom: none; }
  .diag-root .summary-table td.id { font-family: "SF Mono", Monaco, monospace; font-weight: 600; }

  .diag-root footer.diag-footer { margin-top: 56px; padding-top: 20px; border-top: 1px solid #e5e7ef; font-size: 12px; color: #6b7394; }
  .diag-root .legend { display: flex; gap: 16px; flex-wrap: wrap; font-size: 12px; color: #6b7394; margin: 12px 0 20px; }
  .diag-root .legend .item { display: flex; align-items: center; gap: 6px; }
  .diag-root .legend .swatch { width: 10px; height: 10px; border-radius: 2px; }
  .diag-root .hl-red { color: #df1b41; font-weight: 600; }
  .diag-root .hl-orange { color: #c94c00; font-weight: 600; }
</style>

<div class="diag-root">

<h1>SnapCheckAlgo · /api/v1/analyze 管线诊断报告</h1>
<div class="meta">
  <span>日期：2026-04-22</span>
  <span>分支：feat/debug-trace-panel</span>
  <span>诊断对象：<code>src/app/api/v1/analyze/route.js</code> + <code>lib/intel/**</code></span>
</div>

<div class="intro">
  SN 平台反馈生产请求 <code>req_sn_*</code> 的背调结果把<strong>卖家自家域名 starseedpkg.com</strong> 当成了发件方 URL，导致 <code>fetchWebsite</code> 和 <code>wayback</code> 打回自家站。顺着这条证据链完整查了一遍 <code>/api/v1/analyze</code>，共找到 <strong>11 个问题</strong>——1 个直接对应用户现场 bug，2 个同级严重性，另 8 个是顺带查出的质量 / 可靠性 / 健壮性缺陷。所有问题都是 SnapCheckAlgo 服务端自己的实现问题，修复都在 <code>src/app/**</code> 和 <code>lib/**</code> 内。
</div>

<div class="toc">
  <h3>目录</h3>
  <ol>
    <li><a href="#pipeline">管线完整流程（11 个 stage）</a></li>
    <li><a href="#problems">问题清单（11 项）</a></li>
    <li><a href="#plan">分阶段修复计划</a></li>
    <li><a href="#summary">问题 ↔ 步骤 对照表</a></li>
  </ol>
</div>

<h2 id="pipeline"><span class="num">1.</span>管线完整流程</h2>

<div class="legend">
  <div class="item"><span class="swatch" style="background:#00a163"></span>无问题</div>
  <div class="item"><span class="swatch" style="background:#bf9500"></span>有 Medium/High 级问题</div>
  <div class="item"><span class="swatch" style="background:#df1b41"></span>有 Critical 级问题</div>
  <div class="item">点击右上角 <span class="badge critical" style="cursor:default">P?</span> 徽章可跳到问题详情</div>
</div>

<div class="contract-box">
  <div class="label">典型请求体（来自 SN 平台，按 sn-integration-guide.md §2.1 规范）</div>
<pre><code><span class="kw">POST</span> /api/v1/analyze
<span class="kw">Authorization:</span> Bearer &lt;SERVICE_API_KEY&gt;

{
  <span class="str">"request_id"</span>: <span class="str">"req_sn_abc123"</span>,
  <span class="str">"inquiry_text"</span>: <span class="str">"Hello, I saw your website starseedpkg.com..."</span>,
  <span class="str">"company_profile"</span>: <span class="str">"# 星籽包装 ...（2000-3000 字 markdown 报告）..."</span>,  <span class="cmt">← §2.1 / §10.7 规定的推荐形态：字符串</span>
  <span class="str">"inquiry_images"</span>: [...],
  <span class="str">"enable_intel"</span>: <span class="kw">true</span>,
  <span class="str">"scan_mode"</span>: <span class="str">"online"</span>
}</code></pre>
</div>

<div class="pipeline">

  <div class="stage" id="s1">
    <div class="stage-header">
      <span class="stage-num">1</span>
      <span class="stage-name">Auth 校验</span>
      <span class="stage-type">sync</span>
      <span class="stage-loc">route.js:27-31</span>
    </div>
    <div class="stage-body">
      <div class="io-row"><span class="io-label">IN</span><span class="io-content"><code>Authorization: Bearer &lt;key&gt;</code></span></div>
      <div class="io-row"><span class="io-label">DO</span><span class="io-content">与 <code>process.env.SERVICE_API_KEY</code> 比对</span></div>
      <div class="io-row"><span class="io-label">OUT</span><span class="io-content">失败 → HTTP 401 普通 JSON；成功 → 继续</span></div>
    </div>
  </div>
  <div class="arrow"></div>

  <div class="stage" id="s2">
    <div class="stage-header">
      <span class="stage-num">2</span>
      <span class="stage-name">Body 解析</span>
      <span class="stage-type">sync</span>
      <span class="stage-loc">route.js:33-38</span>
    </div>
    <div class="stage-body">
      <div class="io-row"><span class="io-label">IN</span><span class="io-content">HTTP request body</span></div>
      <div class="io-row"><span class="io-label">DO</span><span class="io-content"><code>await req.json()</code></span></div>
      <div class="io-row"><span class="io-label">OUT</span><span class="io-content">失败 → HTTP 400；成功 → body 对象</span></div>
    </div>
  </div>
  <div class="arrow"></div>

  <div class="stage critical" id="s3">
    <div class="stage-header">
      <span class="stage-num">3</span>
      <span class="stage-name">请求规范化 + 拆包</span>
      <span class="stage-type">sync</span>
      <span class="stage-loc">requestNormalizer.js + route.js:40-50</span>
    </div>
    <div class="stage-body">
      <div class="io-row"><span class="io-label">IN</span><span class="io-content">body 对象（新旧字段混杂）</span></div>
      <div class="io-row"><span class="io-label">DO</span><span class="io-content">
        新旧字段归一化；然后：<br>
        <code>companyObj = typeof company_profile === 'object' ? company_profile : {}</code><br>
        <code>companyText = typeof company_profile === 'string' ? company_profile : ''</code>
      </span></div>
      <div class="io-row"><span class="io-label">OUT</span><span class="io-content">
        <code>companyObj</code> / <code>companyText</code> / <code>inquiry_text</code> / <code>inquiry_images</code> / <code>enable_intel</code>
      </span></div>
      <div class="issue-badges">
        <a href="#p1" class="badge critical">P1 · 自己背调自己（根因入口）</a>
      </div>
    </div>
  </div>
  <div class="arrow"></div>

  <div class="stage" id="s4">
    <div class="stage-header">
      <span class="stage-num">4</span>
      <span class="stage-name">SSE 流开启 + 心跳启动</span>
      <span class="stage-type">async</span>
      <span class="stage-loc">route.js:52-65, 148-152</span>
    </div>
    <div class="stage-body">
      <div class="io-row"><span class="io-label">DO</span><span class="io-content">
        打开 <code>ReadableStream</code>；绑定 <code>cancel</code> 钩子；启动 8s 心跳定时器；立即 <code>emit('progress', {stage:'queued'})</code>
      </span></div>
      <div class="issue-badges">
        <a href="#p8" class="badge medium">P8 · cancel() 是空操作（心跳泄漏 + obs 不写）</a>
      </div>
    </div>
  </div>
  <div class="arrow"></div>

  <div class="stage" id="s5">
    <div class="stage-header">
      <span class="stage-num">5</span>
      <span class="stage-name">load_settings</span>
      <span class="stage-type">sse progress</span>
      <span class="stage-loc">route.js:155-170</span>
    </div>
    <div class="stage-body">
      <div class="io-row"><span class="io-label">DO</span><span class="io-content">
        <code>getGlobalSettings()</code> → baseUrl / serpApiKey / prompts<br>
        <code>getUserSettings(ADMIN_EMAIL)</code> → apiKey / modelName<br>
        缺任何一项 → <code>fail('config', ...)</code>
      </span></div>
      <div class="io-row"><span class="io-label">OUT</span><span class="io-content"><code>{baseUrl, apiKey, modelName, serpApiKey}</code></span></div>
    </div>
  </div>
  <div class="arrow"></div>

  <div class="stage has-issue" id="s6">
    <div class="stage-header">
      <span class="stage-num">6</span>
      <span class="stage-name">prepare_images</span>
      <span class="stage-type">sse progress</span>
      <span class="stage-loc">route.js:173-188</span>
    </div>
    <div class="stage-body">
      <div class="io-row"><span class="io-label">IN</span><span class="io-content"><code>inquiry_images[0..3]</code>（最多 4 张）</span></div>
      <div class="io-row"><span class="io-label">DO</span><span class="io-content">
        base64 直接采纳；URL → <code>fetch(img.url)</code> → 转 base64<br>
        失败：<code>catch { /* skip */ }</code>
      </span></div>
      <div class="io-row"><span class="io-label">OUT</span><span class="io-content"><code>preparedImages[]</code></span></div>
      <div class="issue-badges">
        <a href="#p6" class="badge high">P6 · 图片下载无 UA / 失败静默</a>
      </div>
    </div>
  </div>
  <div class="arrow"></div>

  <div class="stage critical" id="s7">
    <div class="stage-header">
      <span class="stage-num">7</span>
      <span class="stage-name">gather_intel（仅 enable_intel=true）</span>
      <span class="stage-type">sse progress</span>
      <span class="stage-loc">route.js:190-209 → lib/intel/index.js</span>
    </div>
    <div class="stage-body">
      <div class="io-row"><span class="io-label">KEY</span><span class="io-content">
        <code>const url = companyObj.website || ''</code> ← <span class="hl-red">字符串形态下永远为空</span>
      </span></div>
      <div class="io-row"><span class="io-label">DO</span><span class="io-content">
        <code>gatherIntel({url, inquiry, images, apiKey, mainModel, globalSettings})</code>
      </span></div>
      <div class="issue-badges">
        <a href="#p1" class="badge critical">P1 · 自背调（现场）</a>
      </div>
    </div>
  </div>

  <div class="arrow"></div>
  <div class="stage substage has-issue" id="s71">
    <div class="stage-header">
      <span class="stage-num">7.1</span>
      <span class="stage-name">fetchWebsite(userUrl) — 抓我方网站</span>
      <span class="stage-loc">intel/index.js:81 → intel/fetchWebsite.js</span>
    </div>
    <div class="stage-body">
      <div class="io-row"><span class="io-label">DO</span><span class="io-content">
        UA: <code>Mozilla/5.0 (compatible; SnapCheckBot/1.0; ...)</code> ← <span class="hl-orange">Bot UA</span><br>
        8s 超时、500KB 上限
      </span></div>
      <div class="io-row"><span class="io-label">OUT</span><span class="io-content">
        url='' → <code>{status:'skipped'}</code>；否则 <code>{status, title, siteName, excerpt}</code>
      </span></div>
      <div class="issue-badges">
        <a href="#p2" class="badge critical">P2 · Bot UA / 无 SerpAPI fallback</a>
        <a href="#p5" class="badge high">P5 · 每次重抓（浪费 8s）</a>
      </div>
    </div>
  </div>

  <div class="arrow"></div>
  <div class="stage substage has-issue" id="s72">
    <div class="stage-header">
      <span class="stage-num">7.2</span>
      <span class="stage-name">userContext serpSearch — 搜我方品牌网络足迹</span>
      <span class="stage-loc">intel/index.js:82-101</span>
    </div>
    <div class="stage-body">
      <div class="io-row"><span class="io-label">DO</span><span class="io-content">
        若 <code>userSite.status==='ok'</code> 且有 serpKey：<code>deriveUserQueryFromSite</code> → <code>serpSearch({q:"brand", num:5})</code>
      </span></div>
      <div class="io-row"><span class="io-label">OUT</span><span class="io-content"><code>{query, results}</code> 或 <code>null</code>（作为主 LLM 的 silent context）</span></div>
      <div class="issue-badges">
        <a href="#p5" class="badge high">P5 · 每次重跑（浪费 1 条 Serper 额度）</a>
      </div>
    </div>
  </div>

  <div class="arrow"></div>
  <div class="stage substage critical" id="s73">
    <div class="stage-header">
      <span class="stage-num">7.3</span>
      <span class="stage-name">extractEntities — 发件方实体抽取</span>
      <span class="stage-loc">intel/index.js:116-126 → intel/extract.js</span>
    </div>
    <div class="stage-body">
      <div class="io-row"><span class="io-label">IN</span><span class="io-content">
        <code>{inquiry, images, userUrl: url, websiteText: userSite.excerpt, ...}</code><br>
        注意：当 <code>url=''</code> 时 <code>websiteText=''</code>，抽取 LLM 也没有"我方是谁"的上下文
      </span></div>
      <div class="io-row"><span class="io-label">DO</span><span class="io-content">
        <b>a)</b> 有图 → <code>transcribeImages</code> OCR 转录<br>
        <b>b)</b> 主抽取 LLM 调用（返回结构化 JSON）<br>
        <b>c)</b> <em>defensive self-clear</em>：<code>extracted.companyUrl</code> 域名 === <code>userUrl</code> 域名 → 清空（<code>url=''</code> 时此分支不触发）<br>
        <b>d)</b> <span class="hl-red">regex fallback</span>：若 companyUrl 为 null，扫 <code>combinedText = inquiry + imageTranscript</code><br>
        &nbsp;&nbsp;&nbsp;&nbsp;→ <code>deriveCompanyUrlFromText(combinedText, userUrl)</code><br>
        &nbsp;&nbsp;&nbsp;&nbsp;→ 内部 <code>if (excludeDomain && typeof excludeDomain === 'string')</code>：<span class="hl-red">空串 falsy，自排除整段跳过</span><br>
        &nbsp;&nbsp;&nbsp;&nbsp;→ 正则扫到询盘里出现的 <code>starseedpkg.com</code>，拿它当发件方 URL<br>
        <b>e)</b> email fallback：从邮箱域名派生（gmail 等免费邮排除）
      </span></div>
      <div class="io-row"><span class="io-label">OUT</span><span class="io-content">
        <code>{companyName, companyUrl=<span class="hl-red">"https://starseedpkg.com"</span>, personName, ...}</code> ← <b>发件方被错当成我方</b>
      </span></div>
      <div class="issue-badges">
        <a href="#p1" class="badge critical">P1 · 自背调的实际爆点</a>
        <a href="#p4" class="badge high">P4 · regex fallback 对 null 输出信心过高</a>
      </div>
    </div>
  </div>

  <div class="arrow"></div>
  <div class="stage substage has-issue" id="s74">
    <div class="stage-header">
      <span class="stage-num">7.4</span>
      <span class="stage-name">fanout — 8 路并发 OSINT 搜索</span>
      <span class="stage-loc">intel/index.js:136-155</span>
    </div>
    <div class="stage-body">
      <div class="io-row"><span class="io-label">KEY</span><span class="io-content"><code>targetUrl = extracted?.companyUrl || null</code> ← 上一步被污染为 <code>starseedpkg.com</code></span></div>
      <div class="io-row"><span class="io-label">DO</span><span class="io-content">
        Promise.all 并发：<br>
        <code>fetchWebsite(targetUrl)</code> — 抓发件方网站（实际抓了自家站）<br>
        <code>waybackFirstSnapshot(targetUrl)</code> — 查自家站建站时间（毫无意义）<br>
        <code>searchLinkedIn / Facebook / Panjiva / Negative / General / Phone</code>（不依赖 URL，不受 P1 影响）
      </span></div>
      <div class="io-row"><span class="io-label">OUT</span><span class="io-content">8 个子键 <code>{status, ...}</code></span></div>
      <div class="issue-badges">
        <a href="#p2" class="badge critical">P2 · target fetchWebsite 即使没 P1，真实场景大面积 403</a>
        <a href="#p11" class="badge medium">P11 · Serper gl:us/hl:en 写死</a>
      </div>
    </div>
  </div>
  <div class="arrow"></div>

  <div class="stage critical" id="s8">
    <div class="stage-header">
      <span class="stage-num">8</span>
      <span class="stage-name">llm_analysis — 主分析 LLM</span>
      <span class="stage-type">sse progress</span>
      <span class="stage-loc">route.js:212-344</span>
    </div>
    <div class="stage-body">
      <div class="io-row"><span class="io-label">DO</span><span class="io-content">
        <b>a)</b> <code>briefing = formatIntelAsBriefing(intel)</code>（若有 intel）<br>
        <b>b)</b> 构造 <code>userSiteBlock</code>，优先级瀑布：<br>
        &nbsp;&nbsp;1. <code>userSite.status === 'ok'</code> → 用 <code>userSite.excerpt</code>（3000 字 HTML 剥离结果）<br>
        &nbsp;&nbsp;2. else if <code>companyObj.intro</code> → 用结构化对象<br>
        &nbsp;&nbsp;3. else if <code>companyText</code> → 用字符串形态<br>
        &nbsp;&nbsp;4. else → bare url<br>
        &nbsp;&nbsp;<span class="hl-red">问题：第 3 条永远在第 1 条之后</span>——只要 userSite 成功，SN 按契约传入的 2000-3000 字 profile 就被忽略<br>
        <b>c)</b> <code>textPart = briefing + userSiteBlock + 询盘文本</code><br>
        <b>d)</b> <code>fetch(endpoint, { body: { messages, ... } })</code> ← <span class="hl-orange">没有 AbortSignal.timeout</span>
      </span></div>
      <div class="io-row"><span class="io-label">OUT</span><span class="io-content">
        <code>fullText</code>（报告 markdown）+ <code>tokens.{prompt,completion}</code>
      </span></div>
      <div class="issue-badges">
        <a href="#p3" class="badge critical">P3 · companyText 被 userSite 遮蔽</a>
        <a href="#p7" class="badge high">P7 · 主 LLM fetch 无超时</a>
      </div>
    </div>
  </div>
  <div class="arrow"></div>

  <div class="stage has-issue" id="s9">
    <div class="stage-header">
      <span class="stage-num">9</span>
      <span class="stage-name">post_process</span>
      <span class="stage-type">sse progress</span>
      <span class="stage-loc">route.js:347-394</span>
    </div>
    <div class="stage-body">
      <div class="io-row"><span class="io-label">DO</span><span class="io-content">
        <b>a)</b> <code>riskLevel</code>：扫"高/中/低风险"关键词；miss → 默认 <code>'medium'</code> + log<br>
        <b>b)</b> <code>scores</code>：4 个维度分别正则提取 <code>N/100</code> 格式<br>
        <b>c)</b> <code>buyer</code>：从 <code>extracted</code> 映射 8 字段 + <code>products[]</code>
      </span></div>
      <div class="io-row"><span class="io-label">OUT</span><span class="io-content">
        <code>{risk_level, scores, buyer}</code><br>
        ⚠️ <code>buyer.company_url = extracted.companyUrl</code> → <b>SN 前端展示：发件方网址 = starseedpkg.com</b>
      </span></div>
      <div class="issue-badges">
        <a href="#p10" class="badge medium">P10 · scores 正则对格式漂移脆弱</a>
      </div>
    </div>
  </div>
  <div class="arrow"></div>

  <div class="stage has-issue" id="s10">
    <div class="stage-header">
      <span class="stage-num">10</span>
      <span class="stage-name">saveQuery + emit done + recordObs</span>
      <span class="stage-type">sse done</span>
      <span class="stage-loc">route.js:397-458</span>
    </div>
    <div class="stage-body">
      <div class="io-row"><span class="io-label">DO</span><span class="io-content">
        <b>a)</b> <code>saveQuery</code> → Redis history，<code>userEmail: 'api:\${companyObj.name || "external"}'</code><br>
        &nbsp;&nbsp;&nbsp;&nbsp;字符串形态下 <code>companyObj.name === undefined</code> → 永远 <code>api:external</code><br>
        <b>b)</b> <code>emit('done', {data})</code> — 完整 JSON<br>
        <b>c)</b> <code>recordObs('success')</code> → Upstash 观察日志
      </span></div>
      <div class="issue-badges">
        <a href="#p9" class="badge medium">P9 · saveQuery userEmail 永远 api:external</a>
      </div>
    </div>
  </div>
  <div class="arrow"></div>

  <div class="stage has-issue" id="s11">
    <div class="stage-header">
      <span class="stage-num">11</span>
      <span class="stage-name">Close 或 Cancel</span>
      <span class="stage-type">cleanup</span>
      <span class="stage-loc">route.js:62, 132-137</span>
    </div>
    <div class="stage-body">
      <div class="io-row"><span class="io-label">成功</span><span class="io-content"><code>close()</code> → 清理心跳 + 关闭 controller</span></div>
      <div class="io-row"><span class="io-label">失败</span><span class="io-content"><code>fail(code, msg)</code> → emit error + close + recordObs('error')</span></div>
      <div class="io-row"><span class="io-label">客户端断开</span><span class="io-content"><code>cancel() { /* no-op */ }</code> ← <span class="hl-orange">心跳泄漏 / obs 不写 / LLM 请求不 abort</span></span></div>
      <div class="issue-badges">
        <a href="#p8" class="badge medium">P8 · cancel() 空操作</a>
      </div>
    </div>
  </div>

</div>

<h2 id="problems"><span class="num">2.</span>问题清单</h2>

<p style="color:#6b7394;font-size:13px;">
  按严重性排序。<strong>严重性定义</strong>：Critical = 破坏 feature 正确性；High = 数据质量 / 浪费额度 / 可靠性弱；Medium = 边角 case / 可观测性。
</p>

<div class="problem-grid">

  <div class="problem-card critical" id="p1">
    <div class="problem-header">
      <span class="problem-id">P1</span>
      <span class="severity-tag critical">Critical</span>
      <span class="problem-title">自己背调自己（用户现场 bug）</span>
      <span class="problem-steps">涉及 <a href="#s3">Step 3</a> · <a href="#s7">Step 7</a> · <a href="#s73">Step 7.3</a></span>
    </div>
    <div class="problem-body">
      <dl>
        <dt>证据链</dt><dd>
<pre><code>[intel/extract] llm_ok { companyUrl: <span class="kw">null</span>, email: <span class="str">"mishtiparul7@gmail.com"</span> }
[intel/extract] fallback { source: <span class="str">"regex_text"</span>, companyUrl: <span class="str">"https://starseedpkg.com"</span> }
[intel/orchestrator] stage { name: <span class="str">"fanout"</span>, targetUrl: <span class="str">"https://starseedpkg.com"</span> }</code></pre>
        </dd>
        <dt>根因</dt><dd>
          <code>route.js:191</code> 只从 <code>companyObj.website</code> 取 <code>url</code>。我方在 <code>sn-integration-guide.md §2.1 / §10.7</code> 里规定：<code>company_profile</code> 的推荐形态就是字符串——SN 按契约传字符串时，<code>companyObj = {}</code>，<code>url = ''</code>。空串一路下传到 <code>deriveCompanyUrlFromText(text, excludeDomain)</code>（<code>extract.js:100</code>），自排除分支 <code>if (excludeDomain && typeof...)</code> 因空串 falsy 整段跳过 → 正则扫到询盘中出现的卖家自家域名（询盘里常有 "I saw your website X.com"），错误提交为发件方 URL。<br>
          <strong>这是服务端代码没兑现自家契约。</strong>
        </dd>
        <dt>修复</dt><dd>
          <b>1.</b> <code>requestNormalizer.js</code> 新增 <code>deriveOwnDomains(company_profile)</code>：对象形态取 <code>.website</code>；字符串形态扫出所有 http(s):// / bare TLD 域名去重返回 <code>string[]</code>。<br>
          <b>2.</b> 单字段 <code>url</code> / <code>userUrl</code> 改为 <code>ownDomains: string[]</code> 贯穿 <code>gatherIntel</code> → <code>extractEntities</code> → <code>deriveCompanyUrlFromText</code>。<br>
          <b>3.</b> <code>deriveCompanyUrlFromText</code> 的 <code>excludeDomain</code> 改为接受 <code>string | string[]</code>，空数组/空串语义等同无排除。<br>
          <b>4.</b> <code>route.js</code> 里 <code>const url</code> 派生补齐：对象形态用 <code>.website</code>；字符串形态用 <code>ownDomains[0]</code>。<br>
          <b>5.</b> 新增测试：字符串 <code>company_profile</code> 含卖家域名、询盘文本也提及该域名 → <code>extracted.companyUrl</code> 不等于卖家域名。
        </dd>
      </dl>
    </div>
  </div>

  <div class="problem-card critical" id="p2">
    <div class="problem-header">
      <span class="problem-id">P2</span>
      <span class="severity-tag critical">Critical</span>
      <span class="problem-title">fetchWebsite 使用 SnapCheckBot UA · target 站大面积 403 · 无 SerpAPI fallback</span>
      <span class="problem-steps">涉及 <a href="#s71">Step 7.1</a> · <a href="#s74">Step 7.4</a></span>
    </div>
    <div class="problem-body">
      <dl>
        <dt>证据</dt><dd>
          <code>lib/intel/fetchWebsite.js:8</code>: <code>USER_AGENT = 'Mozilla/5.0 (compatible; SnapCheckBot/1.0; ...)'</code><br>
          <code>src/app/api/v1/profile/route.js:40-41</code>: Profile 端点反而用的是 <code>Chrome 124</code> 浏览器 UA + Cloudflare 挑战探测 + SerpAPI fallback<br>
          <code>sn-integration-guide.md</code> 附录 A "生产真实请求截取" 里 <code>website: { status: 'failed', error: 'fetch failed' }</code> —— 这是常态
        </dd>
        <dt>根因</dt><dd>
          Bot UA 被绝大多数 Cloudflare / WAF 拦截；且 <code>/analyze</code> 路径下 <code>fetchWebsite</code> 失败没任何补救，<code>website</code> 和依赖它的 <code>wayback</code> 直接变空。<code>/profile</code> 已经验证了"浏览器 UA + SerpAPI 聚合"可以救活大多数 case，但没复用到 <code>/analyze</code>。
        </dd>
        <dt>修复</dt><dd>
          <b>1.</b> 把 <code>/profile/route.js</code> 里的 <code>directFetchWebsite</code> 抽到 <code>lib/intel/fetchWebsite.js</code>，原 <code>fetchWebsite</code> 改为它的 wrapper：浏览器 UA + <code>Accept-Language</code>、Cloudflare 挑战探测、区分 404 / 403+429+503 / 其它。<br>
          <b>2.</b> 抽 <code>serpSiteFallback(url, serpKey)</code> 到 <code>lib/intel/fetchWebsite.js</code>（源自 <code>/profile/route.js:143-184</code>）。<br>
          <b>3.</b> <code>fetchWebsite(url, { enableSerpFallback, serpKey })</code>：<code>userSite</code>（Step 7.1）调用时不启用 fallback；<code>targetSite</code>（Step 7.4）调用时启用。<br>
          <b>4.</b> 返回 <code>{status:'ok', source:'direct_fetch'|'serp_fallback', ...}</code>——对 SN 的 <code>intel.website</code> 结构不改变。
        </dd>
      </dl>
    </div>
  </div>

  <div class="problem-card critical" id="p3">
    <div class="problem-header">
      <span class="problem-id">P3</span>
      <span class="severity-tag critical">Critical</span>
      <span class="problem-title">SN 传入的 profile_report 在主 LLM 注入时被 userSite 遮蔽</span>
      <span class="problem-steps">涉及 <a href="#s8">Step 8</a></span>
    </div>
    <div class="problem-body">
      <dl>
        <dt>证据</dt><dd>
          <code>route.js:223-254</code> 的瀑布：<code>userSite.ok → companyObj.intro → companyText → bare-url</code>。<br>
          P1 修好后 <code>url</code> 会正确派生，<code>userSite.status === 'ok'</code> 大概率成真，第 3 条 <code>companyText</code> 永远轮不到。
        </dd>
        <dt>根因</dt><dd>
          优先级写错：<code>userSite.excerpt</code> 只是 3000 字 HTML 剥离结果，SN 按契约调 <code>/api/v1/profile</code> 生成的 2000-3000 字 markdown 反而被当成最低优先级 fallback。产品语义上，<code>companyText</code> 是"契约规定的、内容最准的资料"，应最高优先。
        </dd>
        <dt>修复</dt><dd>
          <code>route.js</code> 优先级瀑布改为：<code>companyText → companyObj.intro → userSite.excerpt → bare-url</code>。<br>
          另：<code>intel/extract.js</code> 的 <code>websiteText</code> 参数，当 <code>companyText</code> 存在时同样优先用它。
        </dd>
      </dl>
    </div>
  </div>

  <div class="problem-card high" id="p4">
    <div class="problem-header">
      <span class="problem-id">P4</span>
      <span class="severity-tag high">High</span>
      <span class="problem-title">regex fallback 对 LLM 的 null 输出信心过高</span>
      <span class="problem-steps">涉及 <a href="#s73">Step 7.3(d)</a></span>
    </div>
    <div class="problem-body">
      <dl>
        <dt>根因</dt><dd>
          <code>extract.js:409-417</code>：LLM 明确返回 <code>companyUrl: null</code>（含义："发件方没给 URL"），代码立即用正则扫询盘+图片转录兜一个上来，没做任何交叉验证。询盘里提到的任何 URL 都可能被错认为发件方 URL。
        </dd>
        <dt>修复</dt><dd>
          regex 命中只在以下任一条件才提交为 <code>extracted.companyUrl</code>：<br>
          &nbsp;&nbsp;(a) URL 的注册域与 <code>extracted.email</code> 的域名一致（强信号）；<br>
          &nbsp;&nbsp;(b) URL 出现在"签名块"位置（文本末尾 200 字符内，紧邻电话/邮箱行）；<br>
          否则保持 <code>companyUrl: null</code>，下游 <code>website</code>/<code>wayback</code> 自然 <code>skipped</code>——比错抓一个更好。记 <code>log.warn('fallback_rejected')</code> 便于后续调优。
        </dd>
      </dl>
    </div>
  </div>

  <div class="problem-card high" id="p5">
    <div class="problem-header">
      <span class="problem-id">P5</span>
      <span class="severity-tag high">High</span>
      <span class="problem-title">每次 analyze 都重抓自家站 + 重搜自家品牌（浪费 ~8s + 1 Serper 额度/call）</span>
      <span class="problem-steps">涉及 <a href="#s71">Step 7.1</a> · <a href="#s72">Step 7.2</a></span>
    </div>
    <div class="problem-body">
      <dl>
        <dt>根因</dt><dd>
          契约的两步设计：第一步 <code>/api/v1/profile</code> 生成 profile_report 存入 SN 库；第二步每次 <code>/api/v1/analyze</code> 传 <code>company_profile: &lt;report&gt;</code>。但 <code>gatherIntel</code>（<code>intel/index.js:81-101</code>）完全无视已有的 <code>companyText</code>，每次还是去 <code>fetchWebsite</code> + <code>serpSearch</code>。相当于"我方资料"环节在每次 analyze 里被免费重建一次。
        </dd>
        <dt>修复</dt><dd>
          <code>gatherIntel</code> 增加入参 <code>userProfileText</code>：非空 → 跳过 <code>fetchWebsite(url)</code> 和 <code>userContext</code> serp；直接把 <code>userProfileText</code> 作为我方背景传给主 LLM。空 → 现有行为不变（依然抓网站）。<br>
          <code>route.js</code> 把 <code>companyText</code> 以 <code>userProfileText</code> 透传下去。
        </dd>
      </dl>
    </div>
  </div>

  <div class="problem-card high" id="p6">
    <div class="problem-header">
      <span class="problem-id">P6</span>
      <span class="severity-tag high">High</span>
      <span class="problem-title">prepare_images 下载无 UA / 失败静默 drop</span>
      <span class="problem-steps">涉及 <a href="#s6">Step 6</a></span>
    </div>
    <div class="problem-body">
      <dl>
        <dt>根因</dt><dd>
          <code>route.js:180-186</code>：<code>fetch(img.url, { signal: AbortSignal.timeout(10_000) })</code> 无 UA / Accept；<code>} catch { /* skip */ }</code> 失败无日志。图床（很多带防盗链）返回 403 时图片静默消失，SN 前端看不到为什么背调变弱。
        </dd>
        <dt>修复</dt><dd>
          <b>1.</b> 加浏览器 UA（可复用 P2 抽出来的 <code>BROWSER_UA</code>）和 <code>Referer</code>（若 URL 是 SN 上传 CDN）。<br>
          <b>2.</b> 失败分支改为 <code>log.warn('image_fetch_fail', { host, status, reason })</code>，不是静默 <code>catch</code>。<br>
          <b>3.</b> 可选：把图片下载失败累加到 <code>meta.skipped</code>，让 SN 前端有信号。
        </dd>
      </dl>
    </div>
  </div>

  <div class="problem-card high" id="p7">
    <div class="problem-header">
      <span class="problem-id">P7</span>
      <span class="severity-tag high">High</span>
      <span class="problem-title">主 LLM fetch 无 AbortSignal.timeout</span>
      <span class="problem-steps">涉及 <a href="#s8">Step 8</a></span>
    </div>
    <div class="problem-body">
      <dl>
        <dt>根因</dt><dd>
          <code>route.js:298-312</code>：主 LLM fetch 没传 <code>signal</code>。抽取 LLM 那边设了（<code>hasImages ? 45000 : 20000</code>），主 LLM 反而没设，不一致。上游 hang 时要等 Vercel 300s maxDuration，客户端心跳照发但 <code>stage</code> 永远卡在 <code>llm_analysis</code>，定位困难。
        </dd>
        <dt>修复</dt><dd>
          <code>AbortSignal.timeout(180_000)</code>（3 分钟，对慢模型留足余量；仍在 300s maxDuration 内留 2 分钟给其它阶段）。超时走现有 <code>fail('llm', 'timeout')</code> 分支。
        </dd>
      </dl>
    </div>
  </div>

  <div class="problem-card medium" id="p8">
    <div class="problem-header">
      <span class="problem-id">P8</span>
      <span class="severity-tag medium">Medium</span>
      <span class="problem-title">SSE cancel() 空操作 · 心跳泄漏 + 观察日志不写</span>
      <span class="problem-steps">涉及 <a href="#s4">Step 4</a> · <a href="#s11">Step 11</a></span>
    </div>
    <div class="problem-body">
      <dl>
        <dt>根因</dt><dd>
          <code>route.js:62</code>：<code>cancel() { /* client disconnected */ }</code>。客户端断开时：心跳定时器继续到 maxDuration；观察日志不 fire（abandoned 请求在 Upstash 完全没痕迹）；正在 in-flight 的 LLM/intel 请求没人 abort，继续烧 token。
        </dd>
        <dt>修复</dt><dd>
          引入一个模块级 <code>AbortController</code>：绑定到下游 <code>fetch</code>（主 LLM、extract LLM、fetchWebsite 等）；<code>cancel()</code> 里 <code>abort()</code> + <code>close()</code> + <code>recordObs('cancelled', null)</code>。
        </dd>
      </dl>
    </div>
  </div>

  <div class="problem-card medium" id="p9">
    <div class="problem-header">
      <span class="problem-id">P9</span>
      <span class="severity-tag medium">Medium</span>
      <span class="problem-title">saveQuery.userEmail 在字符串形态下永远是 api:external</span>
      <span class="problem-steps">涉及 <a href="#s10">Step 10</a></span>
    </div>
    <div class="problem-body">
      <dl>
        <dt>根因</dt><dd>
          <code>route.js:398</code>：<code>userEmail: 'api:\${companyObj.name || "external"}'</code>。字符串形态下 <code>companyObj.name === undefined</code>，所以管理员后台历史全显示 <code>api:external</code>，多租户 SN 场景下无法区分是谁的请求。
        </dd>
        <dt>修复</dt><dd>
          改为 <code>api:sn:\${requestId}</code>（<code>requestId</code> 已存在）。多个请求可通过 <code>requestId</code> 精确定位，且与 <code>obs:analyze:{date}:{requestId}</code> Redis key 对齐。
        </dd>
      </dl>
    </div>
  </div>

  <div class="problem-card medium" id="p10">
    <div class="problem-header">
      <span class="problem-id">P10</span>
      <span class="severity-tag medium">Medium</span>
      <span class="problem-title">scores 正则对 LLM 输出格式漂移脆弱</span>
      <span class="problem-steps">涉及 <a href="#s9">Step 9</a></span>
    </div>
    <div class="problem-body">
      <dl>
        <dt>根因</dt><dd>
          <code>route.js:366</code>：<code>new RegExp(label + '[^0-9]{0,30}(\\d{1,3})\\s*\\/\\s*100')</code> 要求严格 <code>N/100</code> 格式。<code>strategy</code> 已经放宽 label，但数值格式依然卡死。LLM 漂成 <code>85 分</code> / <code>得分: 85</code> / <code>85%</code> 等格式时全部 null。
        </dd>
        <dt>修复</dt><dd>
          <code>pickScore</code> 改两段匹配：先试 <code>(\\d{1,3})\\s*\\/\\s*100</code>；回落到 <code>(\\d{1,3})\\s*(?:分|%)?</code> + 值域 <code>0-100</code>。miss 继续记 <code>log.warn('score_parse_miss', {label})</code>。
        </dd>
      </dl>
    </div>
  </div>

  <div class="problem-card medium" id="p11">
    <div class="problem-header">
      <span class="problem-id">P11</span>
      <span class="severity-tag medium">Medium</span>
      <span class="problem-title">Serper 查询 gl:us / hl:en 写死</span>
      <span class="problem-steps">涉及 <a href="#s74">Step 7.4</a></span>
    </div>
    <div class="problem-body">
      <dl>
        <dt>根因</dt><dd>
          <code>lib/intel/serpapi.js:87</code>：<code>body: JSON.stringify({ q: query, num, gl: 'us', hl: 'en', ...extra })</code>。对 <code>"上海XX公司"</code> 类中文 query，US/EN 本地化偏移会降低命中率。
        </dd>
        <dt>修复</dt><dd>
          自动语言检测：query 含 CJK 字符时切 <code>gl:cn, hl:zh-cn</code>；否则保持现状。允许调用方通过 <code>extra</code> 覆盖。
        </dd>
      </dl>
    </div>
  </div>

</div>

<h2 id="plan"><span class="num">3.</span>分阶段修复计划</h2>

<p style="color:#6b7394;font-size:13px;">每个 Phase 是一个独立 PR；Phase 1 先 land，Phase 2 依赖 Phase 1 的 requestNormalizer 重构。</p>

<div class="phase">
  <div class="phase-header">
    <span class="phase-tag">Phase 1</span>
    <span class="phase-name">止血 — 修复用户现场看见的自背调 bug</span>
    <span class="phase-covers">覆盖 <a href="#p1">P1</a> · <a href="#p3">P3</a> · <a href="#p4">P4</a></span>
  </div>
  <ol>
    <li><code>lib/requestNormalizer.js</code>：新增 <code>deriveOwnDomains(company_profile)</code>，返回 <code>string[]</code>。</li>
    <li><code>lib/intel/extract.js</code>：<code>deriveCompanyUrlFromText</code> 的 <code>excludeDomain</code> 参数改为 <code>string | string[]</code>；<code>extractEntities</code> 的 <code>userUrl</code> 改为 <code>ownDomains: string[]</code>。</li>
    <li><code>lib/intel/extract.js</code>：regex fallback 加置信度门控（域名匹配 email 或签名块位置）；未通过时保持 null + log。</li>
    <li><code>lib/intel/index.js</code> + <code>src/app/api/v1/analyze/route.js</code>：把 <code>ownDomains</code> 贯穿传下去；<code>url</code> 派生从 <code>ownDomains[0]</code> 兜底。</li>
    <li><code>route.js</code> 的 <code>userSiteBlock</code> 优先级瀑布调整：<code>companyText → companyObj.intro → userSite.excerpt → bare-url</code>。</li>
    <li><code>lib/intel/extract.js</code> 的 <code>websiteText</code> 参数同样优先 <code>companyText</code>。</li>
    <li>测试：<code>test/intel/extract.test.js</code> 新增 4 个用例 —— 字符串形态 + 询盘含卖家域名 / 询盘无域名 / 对象形态 / 多个候选域名。</li>
  </ol>
</div>

<div class="phase">
  <div class="phase-header">
    <span class="phase-tag">Phase 2</span>
    <span class="phase-name">情报管线健壮性 — 提升 website/wayback 命中率，砍冗余开销</span>
    <span class="phase-covers">覆盖 <a href="#p2">P2</a> · <a href="#p5">P5</a> · <a href="#p6">P6</a></span>
  </div>
  <ol>
    <li><code>lib/intel/fetchWebsite.js</code>：UA 换浏览器 + 加 Cloudflare 挑战探测（从 <code>/profile/route.js:67-138</code> 抽出）。</li>
    <li><code>lib/intel/fetchWebsite.js</code>：新增 <code>serpSiteFallback(url, serpKey)</code>（从 <code>/profile/route.js:143-184</code> 抽出），<code>fetchWebsite</code> 接 <code>{ enableSerpFallback, serpKey }</code> 选项。</li>
    <li><code>lib/intel/index.js</code>：<code>userSite</code> 调用 <code>enableSerpFallback: false</code>；target <code>website</code> 调用 <code>enableSerpFallback: true</code>。</li>
    <li><code>lib/intel/index.js</code> + <code>route.js</code>：<code>gatherIntel</code> 加入参 <code>userProfileText</code>，非空时跳过 userSite 抓取 + userContext serp。</li>
    <li><code>route.js</code> prepare_images 加浏览器 UA + 失败日志。</li>
    <li>测试：mock Cloudflare challenge 响应 → <code>fetchWebsite</code> 走 SerpAPI fallback 成功返回 <code>source: 'serp_fallback'</code>。</li>
  </ol>
</div>

<div class="phase">
  <div class="phase-header">
    <span class="phase-tag">Phase 3</span>
    <span class="phase-name">可观测性 + 健壮性打磨</span>
    <span class="phase-covers">覆盖 <a href="#p7">P7</a> · <a href="#p8">P8</a> · <a href="#p9">P9</a> · <a href="#p10">P10</a> · <a href="#p11">P11</a></span>
  </div>
  <ol>
    <li>主 LLM fetch 加 <code>AbortSignal.timeout(180_000)</code>。</li>
    <li>引入 module 级 <code>AbortController</code>，<code>cancel()</code> 里 abort + close + recordObs('cancelled')；下游 fetch 传 signal。</li>
    <li><code>saveQuery.userEmail</code> 改 <code>api:sn:\${requestId}</code>。</li>
    <li><code>pickScore</code> 两段匹配。</li>
    <li><code>serpapi.js</code> 自动 CJK 语言检测。</li>
    <li>测试：心跳泄漏单测；超时单测；取消单测。</li>
  </ol>
</div>

<h2 id="summary"><span class="num">4.</span>问题 ↔ 步骤 对照表</h2>

<table class="summary-table">
  <thead>
    <tr>
      <th>ID</th>
      <th>严重性</th>
      <th>问题</th>
      <th>所在步骤</th>
      <th>修复文件</th>
    </tr>
  </thead>
  <tbody>
    <tr><td class="id"><a href="#p1">P1</a></td><td><span class="severity-tag critical">Critical</span></td><td>自背调</td><td>3 · 7 · 7.3</td><td><code>requestNormalizer.js</code> · <code>extract.js</code> · <code>route.js</code></td></tr>
    <tr><td class="id"><a href="#p2">P2</a></td><td><span class="severity-tag critical">Critical</span></td><td>fetchWebsite Bot UA / 无 fallback</td><td>7.1 · 7.4</td><td><code>fetchWebsite.js</code></td></tr>
    <tr><td class="id"><a href="#p3">P3</a></td><td><span class="severity-tag critical">Critical</span></td><td>companyText 被 userSite 遮蔽</td><td>8</td><td><code>route.js</code> · <code>extract.js</code></td></tr>
    <tr><td class="id"><a href="#p4">P4</a></td><td><span class="severity-tag high">High</span></td><td>regex fallback 信心过高</td><td>7.3</td><td><code>extract.js</code></td></tr>
    <tr><td class="id"><a href="#p5">P5</a></td><td><span class="severity-tag high">High</span></td><td>每次重抓自家站 + 重搜品牌</td><td>7.1 · 7.2</td><td><code>intel/index.js</code> · <code>route.js</code></td></tr>
    <tr><td class="id"><a href="#p6">P6</a></td><td><span class="severity-tag high">High</span></td><td>图片下载无 UA / 静默失败</td><td>6</td><td><code>route.js</code></td></tr>
    <tr><td class="id"><a href="#p7">P7</a></td><td><span class="severity-tag high">High</span></td><td>主 LLM 无超时</td><td>8</td><td><code>route.js</code></td></tr>
    <tr><td class="id"><a href="#p8">P8</a></td><td><span class="severity-tag medium">Medium</span></td><td>SSE cancel 空操作</td><td>4 · 11</td><td><code>route.js</code></td></tr>
    <tr><td class="id"><a href="#p9">P9</a></td><td><span class="severity-tag medium">Medium</span></td><td>saveQuery userEmail 永远 api:external</td><td>10</td><td><code>route.js</code></td></tr>
    <tr><td class="id"><a href="#p10">P10</a></td><td><span class="severity-tag medium">Medium</span></td><td>scores 正则格式脆弱</td><td>9</td><td><code>route.js</code></td></tr>
    <tr><td class="id"><a href="#p11">P11</a></td><td><span class="severity-tag medium">Medium</span></td><td>Serper gl/hl 写死</td><td>7.4</td><td><code>lib/intel/serpapi.js</code></td></tr>
  </tbody>
</table>

<footer class="diag-footer">
  <p>
    诊断范围：<code>POST /api/v1/analyze</code>。所有 11 项修复均在 <code>src/app/api/v1/analyze/**</code> 和 <code>lib/**</code> 内完成。
  </p>
</footer>

</div>
`

export default function DiagnosisPage() {
  return (
    <div
      className="bg-white"
      dangerouslySetInnerHTML={{ __html: REPORT_HTML }}
    />
  )
}
