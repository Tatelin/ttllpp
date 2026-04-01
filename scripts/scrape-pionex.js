/**
 * Pionex éå¹£çè²¡ & USDT Savings æ¸ææå
 *
 * ç¨ Puppeteer headless browser æåå¬éé é¢æ¸æ
 * éå¹£çè²¡ APY æ¯å¬éæ¸æï¼ä¸éè¦ç»å¥
 * VIP Savings å©çéè¦ cookieï¼æ¯ææåæ´æ°ä¸æ¬¡å³å¯ï¼
 */

const puppeteer = require('puppeteer');
const fs = require('fs');

const PAIRS = [
  { key: 'BTC', url: 'https://www.pionex.com/zh-TW/structured-finance/landing?k=USDT&k1=BTC' },
  { key: 'ETH', url: 'https://www.pionex.com/zh-TW/structured-finance/landing?k=USDT&k1=ETH' },
  { key: 'XAUT', url: 'https://www.pionex.com/zh-TW/structured-finance/landing?k=USDT&k1=XAUT' },
];

const SAVINGS_URL = 'https://www.pionex.com/zh-TW/fsarbitrage';

async function scrapePionex() {
  console.log('[SCRAPER] Starting Pionex data scrape...');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const results = {
    updatedAt: new Date().toISOString(),
    dualInvestment: {},
    savings: null,
  };

  try {
    const page = await browser.newPage();

    // è¨­å®åçç User-Agent
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1280, height: 800 });

    // ===== 1. æåéå¹£çè²¡ =====
    for (const pair of PAIRS) {
      console.log(`[SCRAPER] Fetching ${pair.key} dual investment...`);

      try {
        await page.goto(pair.url, {
          waitUntil: 'networkidle2',
          timeout: 30000
        });

        // ç­å¾é é¢å§å®¹è¼å¥
        await page.waitForFunction(
          () => document.body.innerText.includes('%'),
          { timeout: 15000 }
        );

        // é¡å¤ç­å¾ç¢ºä¿åæå§å®¹è¼å¥
        await new Promise(r => setTimeout(r, 3000));

        const text = await page.evaluate(() => document.body.innerText);
        const products = parseDualInvestment(text, pair.key);
        results.dualInvestment[pair.key] = products;

        console.log(`[SCRAPER] ${pair.key}: Found ${products.length} products`);
      } catch (err) {
        console.error(`[SCRAPER] ${pair.key} error:`, err.message);
        results.dualInvestment[pair.key] = [];
      }
    }

    // ===== 2. æå USDT Savings =====
    console.log('[SCRAPER] Fetching USDT savings...');
    try {
      await page.goto(SAVINGS_URL, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      await page.waitForFunction(
        () => document.body.innerText.includes('APY') || document.body.innerText.includes('%'),
        { timeout: 15000 }
      );
      await new Promise(r => setTimeout(r, 3000));

      const text = await page.evaluate(() => document.body.innerText);
      results.savings = parseSavings(text);
      console.log('[SCRAPER] Savings data fetched');
    } catch (err) {
      console.error('[SCRAPER] Savings error:', err.message);
    }

  } finally {
    await browser.close();
  }

  // å¯«å¥ JSON æªæ¡
  fs.writeFileSync('pionex-data.json', JSON.stringify(results, null, 2));
  console.log('[SCRAPER] Data saved to pionex-data.json');
  console.log(JSON.stringify(results, null, 2));
}

/**
 * è§£æéå¹£çè²¡ç¢åæ¸æ
 * é é¢æ ¼å¼ç¯ä¾ï¼
 *   +190.98%  1å¤©  $66,500  â¼0.79%
 *   +120.50%  3å¤©  $65,000  â¼2.88%
 */
function parseDualInvestment(text, pair) {
  const products = [];

  // åè©¦å¤ç¨®æ­£åå¹éæ¨¡å¼
  const patterns = [
    // æ¨¡å¼1: +APY% å¤©æ¸å¤© $å¹æ ¼ â¼è·é¢%
    /\+?([\d.]+)%\s*(\d+)\s*å¤©\s*\$?([\d,]+(?:\.\d+)?)\s*[â¼â²]?\s*([\d.]+)%/g,
    // æ¨¡å¼2: APY å¤©æ¸ ç®æ¨å¹ è·é¢
    /([\d.]+)%\s+(\d+)å¤©\s+([\d,]+(?:\.\d+)?)\s+([\d.]+)%/g,
  ];

  for (const regex of patterns) {
    let match;
    while ((match = regex.exec(text)) !== null) {
      const apy = parseFloat(match[1]);
      const days = parseInt(match[2]);
      const strike = parseFloat(match[3].replace(/,/g, ''));
      const distance = parseFloat(match[4]);

      // åçæ§æª¢æ¥
      if (apy > 0 && apy < 10000 && days >= 1 && days <= 365 && strike > 0) {
        products.push({
          apy,
          days,
          strikePrice: strike,
          distancePercent: distance,
        });
      }
    }
    if (products.length > 0) break;
  }

  // ä¾ APY ç±é«å°ä½æåº
  products.sort((a, b) => b.apy - a.apy);

  // åå 5 åæé« APY çç¢å
  return products.slice(0, 5);
}

/**
 * è§£æ USDT Savings æ¸æ
 */
function parseSavings(text) {
  const savings = {};

  // VIP å©ç
  const vipMatch = text.match(/VIP[^\d]*([\d.]+)\s*%/i);
  if (vipMatch) savings.vip = parseFloat(vipMatch[1]);

  // ç©©å¥å
  const stableMatch = text.match(/ç©©å¥[^\d]*([\d.]+)\s*%/i);
  if (stableMatch) savings.stable = parseFloat(stableMatch[1]);

  // èªç±å / æé«
  const maxMatch = text.match(/(?:æé«|max|èªç±)[^\d]*([\d.]+)\s*%/i);
  if (maxMatch) savings.flexible = parseFloat(maxMatch[1]);

  return Object.keys(savings).length > 0 ? savings : null;
}

// å·è¡
scrapePionex().catch(err => {
  console.error('[SCRAPER] Fatal error:', err);
  process.exit(1);
});
