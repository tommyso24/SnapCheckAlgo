# SnapCheckAlgo · 开发进度笔记

> 秒探分析引擎——外贸询盘 OSINT 情报搜集 + AI 分析。作为独立 API 服务部署，供 SN 平台 (ai-sn) 调用。

**GitHub 仓库**: https://github.com/tommyso24/SnapCheckAlgo（Fork 自 brandnewmax/trade-check）
**生产地址**: https://snap-check-algo.vercel.app
**部署平台**: Vercel（Pro 套餐，Vibe Coding MML 团队，Function 最长 300s）
**数据存储**: Upstash Redis（Singapore 区，Free 套餐）

---

## 项目历程

### 原始开发阶段（2026-04，在 trade-check 仓库）

| 阶段 | 状态 | 核心交付 |
|---|---|---|
| 1. 实时情报检索 | ✅ 已完成 | 4 阶段管线：Serper + Wayback + 多模态抽取 + 情报面板 |
| 2. Stripe 风格重设计 | ✅ 已完成 | Tailwind + Geist；11 组件全重写 |
| 3. 发件方/我方角色反转 | ✅ 已完成 | 情报以发件方为调查目标；fallback 链 |
| 4. 热修复 | ✅ 已完成 | 55/55 测试通过 |

### 平台集成阶段（2026-04-16 起，在 SnapCheckAlgo 仓库）

| 阶段 | 状态 | 说明 |
|---|---|---|
| Fork 仓库 + 重命名 | ✅ 完成 | tommyso24/SnapCheckAlgo |
| Vercel 部署 | ✅ 完成 | snap-check-algo.vercel.app，Upstash Redis 已连接 |
| 环境变量配置 | ✅ 完成 | 13 个变量（7 个手动 + 5 个 Upstash 自动注入 + 1 个 KV_REST_API_URL） |
| 构建验证 | ✅ 完成 | 首页 200，登录 API 401（正常） |
| 迁移至团队空间 | ✅ 完成（04-16） | Hobby/Tom So's projects → **Pro/Vibe Coding MML**，重新 vercel link + 清理重复 UPSTASH_REDIS_REST_URL + 重新部署验证通过 |
| LLM/SerpAPI 配置 | ✅ 已配置 | 日志显示 gemini-3-flash-preview 调用成功 |
| **新增对外 API 接口** | ⏳ 待做 | `POST /api/v1/analyze`，供 SN 平台调用 |
| SN 平台对接 | ⏳ 待做 | ai-sn 后端改为调用 SnapCheckAlgo API |

---

## 系统架构

### 当前架构（独立运行）

```
用户 → SnapCheckAlgo 前端 → /api/analyze（SSE 流式）→ 情报管线 + LLM → 报告
```

### 目标架构（SN 平台集成）

```
SN 平台用户
    │
    ▼
SN 后端 (ai-sn)
  ├── 用户认证、余额检查、扣费
  ├── POST /api/v1/analyze → SnapCheckAlgo
  │       │ Authorization: Bearer <SERVICE_API_KEY>
  │       ▼
  │   SnapCheckAlgo (Vercel)
  │     ├── 验证 API Key
  │     ├── 阶段1: 抓取卖家网站
  │     ├── 阶段2: LLM 提取实体
  │     ├── 阶段3: 8路并发 OSINT 搜索
  │     ├── 阶段4: 主 LLM 分析
  │     └── 返回完整报告 JSON
  │       │
  ├── 存储报告到数据库
  └── 返回报告给前端
```

### 后端情报管线（`lib/intel/gatherIntel`）

```
输入: { inquiry, company, images, options }
         ↓
阶段 1 · 我方背景并行抓取
  ├─ fetchWebsite(我方url) → userSite
  └─ serpSearch("我方品牌名") → userContext
         ↓
阶段 2 · 发件方实体抽取(LLM)
  输入: 询盘文本 + 图片(多模态)
  输出: { companyName, companyUrl, personName, email, phone, country, products }
  fallback: 正则 URL 扫描 → 邮箱域名推导
         ↓
阶段 3 · 8 路并发 OSINT（Serper.dev）
  ├─ fetchWebsite(发件方官网)
  ├─ waybackFirstSnapshot(建站时间)
  ├─ searchLinkedIn(人名+公司名)
  ├─ searchFacebook(公司名)
  ├─ searchPanjiva(海关记录)
  ├─ searchNegative(诈骗关键词)
  ├─ searchGeneral(通用搜索)
  └─ searchPhone(电话记录)
         ↓
阶段 4 · 主 LLM 分析（SSE 流式 / 同步）
  注入: 情报简报 + 我方背景 + 原始询盘
  输出: 风险等级 + 4 维评分 + Markdown 报告
```

---

## 环境变量

### Vercel 上已配置

| 变量名 | 说明 |
|--------|------|
| `UPSTASH_REDIS_REST_URL` | Redis 连接 URL |
| `UPSTASH_REDIS_REST_TOKEN` | Redis 认证 Token |
| `JWT_SECRET` | JWT 签名密钥 |
| `ADMIN_EMAIL` | 管理员邮箱 tommy@mmldigi.com |
| `ADMIN_PASSWORD` | 管理员密码 |
| `TEST_EMAIL` | 测试用户 info@mmldigi.com |
| `TEST_PASSWORD` | 测试用户密码 |
| `KV_*` / `REDIS_URL` | Upstash 自动注入（5个） |

### 待添加（API 对接时）

| 变量名 | 说明 |
|--------|------|
| `SERVICE_API_KEY` | SN 平台调用的认证密钥 |

### 通过 Web 设置页配置（存 Redis）

| 配置项 | 说明 |
|--------|------|
| Base URL | LLM API 端点 |
| API Key | LLM API Key |
| Model Name | 分析模型名 |
| SerpAPI Key | Serper.dev 搜索 Key |
| Extraction Model | 实体提取模型（默认 gemini-2.5-flash） |
| System Prompt | 分析报告系统提示词 |

---

## API 接口设计（待实现）

### `POST /api/v1/analyze`

SN 后端调用，同步返回完整报告。

**认证**: `Authorization: Bearer <SERVICE_API_KEY>`

**请求体**:
```json
{
  "inquiry": "询盘原文...",
  "company": {
    "name": "我方公司名",
    "website": "https://our-company.com",
    "intro": "公司简介",
    "industry": "行业",
    "product_lines": ["产品1", "产品2"]
  },
  "images": [{"url": "https://oss.xxx/image.jpg", "type": "image/jpeg"}],
  "options": {"enable_intel": true, "report_tier": "standard"}
}
```

**响应体**:
```json
{
  "ok": true,
  "data": {
    "report": "Markdown 报告...",
    "risk_level": "low/medium/high",
    "scores": {"inquiry": 85, "customer": 72, "match": 68, "strategy": 75},
    "buyer": {"company_name": "...", "person_name": "...", "email": "...", ...},
    "intel": { ... },
    "model": "gemini-3.1-pro-preview",
    "tokens": {"prompt": 5200, "completion": 3100}
  }
}
```

---

## 重要注意事项

- **Pro 套餐**: 已升级至 Vibe Coding MML 团队 Pro 套餐，Function 最长 300s，深度分析可用。
- **同事迭代**: Max 同事继续在 `brandnewmax/trade-check` 做算法实验，验证后通过 PR 同步到本仓库。
- **ai-sn PR #2**: 之前尝试过代码合并方案（把 Python 移植到 ai-sn），已提 PR 但改为 API 方案，由 Stanley 处理。

---

## 未来待办（现阶段不处理）

- **SerpAPI 分布式限流升级**: 当前 `lib/intel/serpapi.js` 的 5 rps 限流是模块级内存令牌桶，仅在单个 Vercel Fluid Compute 实例内生效，不是分布式限流。Beta 阶段 SN 平台接入量低够用。等稳定运行一周后，如果观察到 SerpAPI 429 频繁触发或账单异常，升级为 Upstash Redis 分布式令牌桶（共享 KV，已在项目中可用）。
