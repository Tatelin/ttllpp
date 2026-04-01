# VIP Daily Market Dashboard

超高資產客戶行情分析平台 — 每日 08:00 (UTC+8) 自動更新

## 架構

```
前端 (Cloudflare Pages)  <-  data.json  <-  Worker API (Cloudflare Workers + KV)
                                              |
                                         Cron 07:30 UTC+8
                                              |
                          CoinGecko      NewsAPI.org    Claude Haiku
                          (行情)         (新聞)         (AI 摘要)

GitHub Actions (07:25 UTC+8) -> Puppeteer -> Pionex 雙幣理財 APY -> KV
```

## 快速部署

```bash
npm install
node scripts/setup.js
```

## 月費 ~$3-5/月

Cloudflare Pages + Workers + KV: $0 | NewsAPI: $0 | CoinGecko: $0 | Claude API Haiku: ~$3-5/月
