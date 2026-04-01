#!/usr/bin/env node
/**
 * å¯å¥ VIP UID ç½åå®å° Cloudflare KV
 *
 * ä½¿ç¨æ¹å¼ï¼
 *   node scripts/seed-uids.js
 *
 * éè¦ç°å¢è®æ¸ï¼
 *   CF_ACCOUNT_ID   â Cloudflare Account ID
 *   KV_NAMESPACE_ID â KV Namespace ID
 *   CF_API_TOKEN    â Cloudflare API Tokenï¼é KV å¯«å¥æ¬éï¼
 *
 * æèç´æ¥ç¨ wrangler CLIï¼
 *   è¦ä¸æ¹ printWranglerCommands()
 */

const fs = require('fs');
const https = require('https');

const config = JSON.parse(fs.readFileSync('./config/vip-uids.json', 'utf-8'));

// ===== æ¹æ³ä¸ï¼ç¨ Cloudflare API ç´æ¥å¯«å¥ =====
async function seedWithAPI() {
  const accountId = process.env.CF_ACCOUNT_ID;
  const kvId = process.env.KV_NAMESPACE_ID;
  const token = process.env.CF_API_TOKEN;

  if (!accountId || !kvId || !token) {
    console.log('ç¼ºå°ç°å¢è®æ¸ï¼æ¹ç¨ wrangler æä»¤æ¹å¼ï¼\n');
    printWranglerCommands();
    return;
  }

  console.log(`å¯å¥ ${config.uids.length} å VIP UID...\n`);

  for (const user of config.uids) {
    const value = JSON.stringify({
      name: user.name,
      addedAt: new Date().toISOString(),
    });

    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${kvId}/values/auth:uid:${user.uid}`;

    await new Promise((resolve, reject) => {
      const req = https.request(url, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            console.log(`  â UID ${user.uid} (${user.name})`);
          } else {
            console.log(`  â UID ${user.uid} â Error: ${body}`);
          }
          resolve();
        });
      });
      req.on('error', reject);
      req.write(value);
      req.end();
    });
  }

  // å¯«å¥ UID ç´¢å¼åè¡¨
  const listValue = JSON.stringify(config.uids.map(u => ({
    uid: u.uid,
    name: u.name,
    addedAt: new Date().toISOString(),
  })));

  const listUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${kvId}/values/auth:uid-list`;
  await new Promise((resolve, reject) => {
    const req = https.request(listUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        console.log(`\n  â UID ç´¢å¼åè¡¨å·²æ´æ°`);
        resolve();
      });
    });
    req.on('error', reject);
    req.write(listValue);
    req.end();
  });

  console.log('\nå¯å¥å®æï¼');
}

// ===== æ¹æ³äºï¼å°åº wrangler CLI æä»¤ =====
function printWranglerCommands() {
  console.log('# === è¤è£½ä»¥ä¸æä»¤å°çµç«¯æ©å·è¡ ===\n');
  console.log('cd worker\n');

  for (const user of config.uids) {
    const value = JSON.stringify({ name: user.name, addedAt: new Date().toISOString() });
    console.log(`# ${user.name} (${user.uid})`);
    console.log(`npx wrangler kv key put --binding=DASHBOARD_KV "auth:uid:${user.uid}" '${value}'\n`);
  }

  const listValue = JSON.stringify(config.uids.map(u => ({
    uid: u.uid,
    name: u.name,
    addedAt: new Date().toISOString(),
  })));
  console.log(`# UID ç´¢å¼åè¡¨`);
  console.log(`npx wrangler kv key put --binding=DASHBOARD_KV "auth:uid-list" '${listValue}'\n`);

  console.log('# === å®æ ===');
}

seedWithAPI().catch(err => {
  console.error('Error:', err.message);
  console.log('\næ¹ç¨ wrangler æä»¤æ¹å¼ï¼\n');
  printWranglerCommands();
});
