/**
 * VIP Dashboard â Cloudflare Worker
 *
 * åè½ï¼
 * 1. Cron æç¨æ¯å¤© 07:30 UTC+8 èªåæåæææ¸æ
 * 2. ç¨ Claude Haiku çæ AI ä¸­ææè³æè¦
 * 3. çµè£ data.json å¯«å¥ KV
 * 4. æä¾ /api/data ç«¯é»çµ¦åç«¯è®å
 */

// ===== æ°èæå°ç­ç¥ï¼6 åç²¾æºé¡å¥ =====
const NEWS_QUERIES = [
  {
    category: 'geopolitical',
    label: 'å°ç·£æ¿æ²»',
    query: 'Iran OR "Middle East" OR "Strait of Hormuz" OR sanctions OR "military conflict" OR Taiwan',
  },
  {
    category: 'fed',
    label: 'å¤®è¡æ¿ç­',
    query: '"Federal Reserve" OR "interest rate" OR "rate cut" OR Powell OR "central bank" OR inflation',
  },
  {
    category: 'institutional',
    label: 'æ©æ§åå',
    query: 'BlackRock OR "Bitcoin ETF" OR "ETF flow" OR "institutional crypto" OR Grayscale',
  },
  {
    category: 'political',
    label: 'æ¿æ²»è¨è',
    query: 'Trump AND (tariff OR crypto OR trade OR regulation)',
  },
  {
    category: 'gold',
    label: 'é»éé¿éª',
    query: '"gold price" OR "safe haven" OR "central bank gold" OR XAUT OR "gold reserve"',
  },
  {
    category: 'sector',
    label: 'ç¢æ¥­åå',
    query: 'Micron OR NVIDIA OR "AI spending" OR "tech earnings" OR semiconductor',
  },
];

// ===== èªè­å·¥å·å½æ¸ =====

// é©è­ Pionex UID æ ¼å¼ï¼8 ä½æ¸å­
function isValidUID(uid) {
  return /^\d{8}$/.test(uid);
}

// çæ session tokenï¼ç°¡å® HMACï¼
async function generateSessionToken(uid, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(uid + ':' + Math.floor(Date.now() / 86400000)));
  return uid + '.' + btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/[+/=]/g, '');
}

// é©è­ session token
async function verifySessionToken(token, secret, env) {
  if (!token) return null;
  const uid = token.split('.')[0];
  if (!isValidUID(uid)) return null;
  // æª¢æ¥ UID æ¯å¦å¨ç½åå®
  const allowed = await env.DASHBOARD_KV.get('auth:uid:' + uid);
  if (!allowed) return null;
  return uid;
}

// å¾ cookie åå¾ session
function getSessionFromCookie(request) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/vip_session=([^;]+)/);
  return match ? match[1] : null;
}

// ===== ä¸»å¥å£ =====
export default {
  // Cron è§¸ç¼ï¼æ¯æ¥èªåæ´æ°
  async scheduled(event, env, ctx) {
    try {
      console.log('[CRON] Starting daily data build...');
      const data = await buildDashboardData(env);
      await env.DASHBOARD_KV.put('dashboard-data', JSON.stringify(data), {
        // è¨­å® 48 å°æéæï¼ç¢ºä¿å³ä½¿ Cron å¤±æä¹ä¸æé¡¯ç¤ºå¤ªèçæ¸æ
        expirationTtl: 172800,
      });
      console.log('[CRON] Dashboard data updated successfully');
    } catch (err) {
      console.error('[CRON] Error:', err.message);
      // å¯«å¥é¯èª¤è¨é
      await env.DASHBOARD_KV.put('last-error', JSON.stringify({
        time: new Date().toISOString(),
        message: err.message,
      }));
    }
  },

  // HTTP è«æ±èç
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // ===== èªè­ç¸é API =====

    // POST /api/auth/login â ç¨ Pionex UID ç»å¥
    if (url.pathname === '/api/auth/login' && request.method === 'POST') {
      try {
        const body = await request.json();
        const uid = (body.uid || '').trim();

        if (!isValidUID(uid)) {
          return new Response(JSON.stringify({ error: 'è«è¼¸å¥ææç 8 ä½æ¸å­ Pionex UID' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // æª¢æ¥ UID æ¯å¦å¨ç½åå®ä¸­
        const allowed = await env.DASHBOARD_KV.get('auth:uid:' + uid);
        if (!allowed) {
          return new Response(JSON.stringify({ error: 'æ­¤ UID å°æªåå¾ VIP æ¥çæ¬éï¼è«è¯ç¹«æ¨çå®¢æ¶ç¶ç' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // çæ session token
        const sessionSecret = env.SESSION_SECRET || env.REFRESH_TOKEN || 'vip-dashboard-secret';
        const token = await generateSessionToken(uid, sessionSecret);

        // è¨éç»å¥
        await env.DASHBOARD_KV.put('auth:login:' + uid, JSON.stringify({
          lastLogin: new Date().toISOString(),
          ip: request.headers.get('CF-Connecting-IP') || 'unknown',
        }));

        return new Response(JSON.stringify({ success: true, uid, token }), {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'Set-Cookie': `vip_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800`,
          },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: 'ç»å¥å¤±æ' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // GET /api/auth/check â æª¢æ¥ç»å¥çæ
    if (url.pathname === '/api/auth/check') {
      const token = getSessionFromCookie(request) || url.searchParams.get('token');
      const sessionSecret = env.SESSION_SECRET || env.REFRESH_TOKEN || 'vip-dashboard-secret';
      const uid = await verifySessionToken(token, sessionSecret, env);
      if (uid) {
        return new Response(JSON.stringify({ authenticated: true, uid }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ authenticated: false }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // POST /api/auth/logout â ç»åº
    if (url.pathname === '/api/auth/logout') {
      return new Response(JSON.stringify({ success: true }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Set-Cookie': 'vip_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0',
        },
      });
    }

    // ===== ç®¡çå¡ APIï¼éè¦ admin tokenï¼ =====

    // POST /api/admin/uid â æ°å¢ / åªé¤ VIP UID
    if (url.pathname === '/api/admin/uid' && request.method === 'POST') {
      const adminToken = url.searchParams.get('token') || request.headers.get('X-Admin-Token');
      if (adminToken !== env.REFRESH_TOKEN) {
        return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      }
      try {
        const body = await request.json();
        const { action, uid, name } = body;

        if (!isValidUID(uid)) {
          return new Response(JSON.stringify({ error: 'Invalid UID format (8 digits)' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        if (action === 'add') {
          await env.DASHBOARD_KV.put('auth:uid:' + uid, JSON.stringify({
            name: name || 'VIP Client',
            addedAt: new Date().toISOString(),
          }));
          // åæ­¥æ´æ°ç½åå®ç´¢å¼
          const listStr = await env.DASHBOARD_KV.get('auth:uid-list') || '[]';
          const list = JSON.parse(listStr);
          if (!list.find(u => u.uid === uid)) {
            list.push({ uid, name: name || 'VIP Client', addedAt: new Date().toISOString() });
            await env.DASHBOARD_KV.put('auth:uid-list', JSON.stringify(list));
          }
          return new Response(JSON.stringify({ success: true, message: `UID ${uid} added` }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        if (action === 'remove') {
          await env.DASHBOARD_KV.delete('auth:uid:' + uid);
          const listStr = await env.DASHBOARD_KV.get('auth:uid-list') || '[]';
          const list = JSON.parse(listStr).filter(u => u.uid !== uid);
          await env.DASHBOARD_KV.put('auth:uid-list', JSON.stringify(list));
          return new Response(JSON.stringify({ success: true, message: `UID ${uid} removed` }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ error: 'action must be "add" or "remove"' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // GET /api/admin/uids â ååºææ VIP UIDs
    if (url.pathname === '/api/admin/uids') {
      const adminToken = url.searchParams.get('token') || request.headers.get('X-Admin-Token');
      if (adminToken !== env.REFRESH_TOKEN) {
        return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      }
      const listStr = await env.DASHBOARD_KV.get('auth:uid-list') || '[]';
      return new Response(listStr, {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ===== æ¸æ APIï¼éè¦ç»å¥é©è­ï¼ =====

    // é©è­èº«ä»½ï¼/api/data å /api/pionex éè¦ç»å¥ï¼
    const protectedPaths = ['/api/data', '/api/pionex'];
    if (protectedPaths.includes(url.pathname)) {
      const token = getSessionFromCookie(request) || url.searchParams.get('session');
      const sessionSecret = env.SESSION_SECRET || env.REFRESH_TOKEN || 'vip-dashboard-secret';
      const uid = await verifySessionToken(token, sessionSecret, env);
      if (!uid) {
        return new Response(JSON.stringify({ error: 'Unauthorized', needLogin: true }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // API: åå¾ææ° dashboard æ¸æ
    if (url.pathname === '/api/data') {
      const data = await env.DASHBOARD_KV.get('dashboard-data');
      if (!data) {
        return new Response(JSON.stringify({ error: 'No data available yet' }), {
          status: 503,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(data, {
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
      });
    }

    // API: åå¾ Pionex æ¸æï¼ç± GitHub Actions å¯«å¥ï¼
    if (url.pathname === '/api/pionex') {
      const data = await env.DASHBOARD_KV.get('pionex-data');
      if (!data) {
        return new Response(JSON.stringify({ error: 'No Pionex data' }), {
          status: 503,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(data, {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // API: æåè§¸ç¼æ´æ°ï¼éè¦ secret tokenï¼
    if (url.pathname === '/api/refresh') {
      const token = url.searchParams.get('token');
      if (token !== env.REFRESH_TOKEN) {
        return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      }
      const data = await buildDashboardData(env);
      await env.DASHBOARD_KV.put('dashboard-data', JSON.stringify(data), {
        expirationTtl: 172800,
      });
      return new Response(JSON.stringify({ success: true, updatedAt: data.updatedAt }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // API: å¥åº·æª¢æ¥
    if (url.pathname === '/api/health') {
      const lastData = await env.DASHBOARD_KV.get('dashboard-data');
      const lastError = await env.DASHBOARD_KV.get('last-error');
      const parsed = lastData ? JSON.parse(lastData) : null;
      return new Response(JSON.stringify({
        status: 'ok',
        lastUpdated: parsed?.updatedAt || null,
        lastError: lastError ? JSON.parse(lastError) : null,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response('VIP Dashboard API\n\nEndpoints:\n  GET /api/data\n  GET /api/pionex\n  GET /api/health\n  GET /api/refresh?token=xxx', {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'text/plain' },
    });
  },
};

// ===== çµè£å®æ´ Dashboard æ¸æ =====
async function buildDashboardData(env) {
  // ä¸¦è¡æåæææ¸ææº
  const [prices, fearGreed, newsResults, stockData] = await Promise.all([
    fetchCryptoPrices(),
    fetchFearGreed(),
    fetchAllNews(env.NEWS_API_KEY),
    fetchStockData(env.ALPHA_VANTAGE_KEY),
  ]);

  // ç¨ Claude AI çæä¸­ææè¦
  let aiSummary = null;
  if (env.CLAUDE_API_KEY) {
    try {
      aiSummary = await generateAISummary(prices, newsResults, fearGreed, stockData, env.CLAUDE_API_KEY);
    } catch (err) {
      console.error('[AI] Summary generation failed:', err.message);
    }
  }

  return {
    updatedAt: new Date().toISOString(),
    prices,
    stocks: stockData,
    fearGreed,
    news: newsResults,
    aiSummary,
  };
}

// ===== å å¯è²¨å¹£è¡æ (CoinGecko) =====
async function fetchCryptoPrices() {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?' +
      'ids=bitcoin,ethereum,tether-gold&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true',
      { headers: { 'Accept': 'application/json' } }
    );
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
    const data = await res.json();
    return {
      BTC: {
        price: data.bitcoin?.usd || 0,
        change24h: parseFloat((data.bitcoin?.usd_24h_change || 0).toFixed(2)),
        volume24h: data.bitcoin?.usd_24h_vol || 0,
      },
      ETH: {
        price: data.ethereum?.usd || 0,
        change24h: parseFloat((data.ethereum?.usd_24h_change || 0).toFixed(2)),
        volume24h: data.ethereum?.usd_24h_vol || 0,
      },
      XAUT: {
        price: data['tether-gold']?.usd || 0,
        change24h: parseFloat((data['tether-gold']?.usd_24h_change || 0).toFixed(2)),
        volume24h: data['tether-gold']?.usd_24h_vol || 0,
      },
    };
  } catch (err) {
    console.error('[PRICES] CoinGecko error:', err.message);
    return { BTC: { price: 0, change24h: 0 }, ETH: { price: 0, change24h: 0 }, XAUT: { price: 0, change24h: 0 } };
  }
}

// ===== ææ¼èè²ªå©ªææ¸ (Alternative.me) =====
async function fetchFearGreed() {
  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=1');
    if (!res.ok) throw new Error(`FNG ${res.status}`);
    const data = await res.json();
    const value = parseInt(data.data[0].value);
    // ä¸­æåé¡
    let labelZh;
    if (value <= 20) labelZh = 'æ¥µåº¦ææ¼';
    else if (value <= 40) labelZh = 'ææ¼';
    else if (value <= 60) labelZh = 'ä¸­æ§';
    else if (value <= 80) labelZh = 'è²ªå©ª';
    else labelZh = 'æ¥µåº¦è²ªå©ª';

    return {
      value,
      label: data.data[0].value_classification,
      labelZh,
      timestamp: data.data[0].timestamp,
    };
  } catch (err) {
    console.error('[FNG] Error:', err.message);
    return { value: 0, label: 'N/A', labelZh: 'ç¡æ¸æ' };
  }
}

// ===== æ°èæå (NewsAPI.org) =====
async function fetchAllNews(apiKey) {
  if (!apiKey) {
    console.warn('[NEWS] No API key, returning empty');
    return NEWS_QUERIES.map(q => ({ category: q.category, label: q.label, articles: [] }));
  }

  const results = await Promise.all(
    NEWS_QUERIES.map(async (q) => {
      try {
        const res = await fetch(
          `https://newsapi.org/v2/everything?` +
          `q=${encodeURIComponent(q.query)}&` +
          `language=en&sortBy=publishedAt&pageSize=3&` +
          `apiKey=${apiKey}`
        );
        if (!res.ok) throw new Error(`NewsAPI ${res.status}`);
        const data = await res.json();
        return {
          category: q.category,
          label: q.label,
          articles: (data.articles || []).map(a => ({
            title: a.title,
            source: a.source?.name || 'Unknown',
            url: a.url,
            publishedAt: a.publishedAt,
            description: (a.description || '').substring(0, 200),
          })),
        };
      } catch (err) {
        console.error(`[NEWS] ${q.category} error:`, err.message);
        return { category: q.category, label: q.label, articles: [] };
      }
    })
  );

  return results;
}

// ===== ç¾è¡æ¸æ (Alpha Vantage) =====
async function fetchStockData(apiKey) {
  if (!apiKey) return null;
  try {
    // æ S&P 500 ETF (SPY) ä½çºå¤§ç¤åè
    const res = await fetch(
      `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=SPY&apikey=${apiKey}`
    );
    if (!res.ok) throw new Error(`AlphaVantage ${res.status}`);
    const data = await res.json();
    const quote = data['Global Quote'];
    if (!quote) return null;
    return {
      SPY: {
        price: parseFloat(quote['05. price'] || 0),
        change: parseFloat(quote['09. change'] || 0),
        changePct: parseFloat((quote['10. change percent'] || '0').replace('%', '')),
      },
    };
  } catch (err) {
    console.error('[STOCKS] Error:', err.message);
    return null;
  }
}

// ===== Claude AI æè¦çæ =====
async function generateAISummary(prices, news, fearGreed, stocks, apiKey) {
  const newsDigest = news
    .map(n => {
      const topArticle = n.articles[0];
      return topArticle ? `[${n.label}] ${topArticle.title}` : `[${n.label}] ç¡éè¦æ°è`;
    })
    .join('\n');

  const prompt = `ä½ æ¯ä¸ä½æåå°ç£è¶é«è³ç¢ VIP å®¢æ¶çè³æ·±æè³é¡§åãæ ¹æä»¥ä¸å³ææ¸æï¼çæä»æ¥è¡æåææè¦ã

## å³æè¡æ
- BTC: $${prices.BTC.price.toLocaleString()} (${prices.BTC.change24h > 0 ? '+' : ''}${prices.BTC.change24h}%)
- ETH: $${prices.ETH.price.toLocaleString()} (${prices.ETH.change24h > 0 ? '+' : ''}${prices.ETH.change24h}%)
- XAUT: $${prices.XAUT.price.toLocaleString()} (${prices.XAUT.change24h > 0 ? '+' : ''}${prices.XAUT.change24h}%)
- ææ¼è²ªå©ªææ¸: ${fearGreed.value} (${fearGreed.labelZh})
${stocks?.SPY ? `- S&P 500 (SPY): $${stocks.SPY.price} (${stocks.SPY.changePct > 0 ? '+' : ''}${stocks.SPY.changePct}%)` : ''}

## ä»æ¥éè¦æ°è
${newsDigest}

## è¼¸åºè¦æ±
è«ä»¥ JSON æ ¼å¼åè¦ï¼åå«ä»¥ä¸æ¬ä½ï¼
{
  "regime": "risk-on" æ "risk-off" æ "neutral",
  "regimeZh": "çå¤" æ "çç©º" æ "ä¸­æ§è§æ",
  "headline": "ä¸å¥è©±ç¸½çµä»æ¥å¸å ´ï¼30å­å§ï¼ç¹é«ä¸­æï¼çµè«å°åï¼",
  "takeaways": ["éé»1", "éé»2", "éé»3"],
  "actionItems": [
    {"text": "è¡åå»ºè­°æè¿°", "tag": "é²å®åªå æ æ©æ æ è§å¯ æ é«åº¦éæ³¨", "detail": "è©³ç´°èªªæï¼50å­å§ï¼"}
  ],
  "newsDigest": [
    {"category": "é¡å¥åç¨±", "summary": "50å­ç¹é«ä¸­ææè¦", "impact": "é«/ä¸­/ä½", "action": "å°æè³çå½±é¿å¤æ·"}
  ]
}

æ³¨æï¼
1. çµè«åè¡ï¼ä¸è¦å ç æ¸æ
2. æ¯æ¢å»ºè­°å¿é å¯å·è¡ï¼æå·é«æ¨çææéé»ï¼
3. ä½¿ç¨ç¹¡é«ä¸­æ
4. èªæ°£å°æ¥­ä½ç´æ¥ï¼åç§äººéè¡å®¶å°è©±
5. åè¦ç´ JSONï¼ä¸è¦ markdown åè£`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Claude API ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const text = data.content[0].text;

  // åè©¦è§£æ JSONï¼èçå¯è½ç markdown åè£ï¼
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI response not valid JSON');
  return JSON.parse(jsonMatch[0]);
}
