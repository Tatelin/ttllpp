#!/usr/bin/env node
/**
 * VIP Dashboard 快速設定嫮導
 *
 * 使用方式：node scripts/setup.js
 * 會引導你設定所有必要的 API keys 和 Cloudflare 配置
 */

const readline = require('readline');
const fs = require('fs');
const { execSync } = require('child_process');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question) {
  return new Promise(resolve => {
    rl.question(question, answer => resolve(answer.trim()));
  });
}

async function main() {
  console.log('\n==========================================');
  console.log('  VIP Dashboard 部署設定嫮導');
  console.log('==========================================\n');

  // Check prerequisites
  console.log('檢查必要工具...');
  try {
    execSync('npx wrangler --version', { stdio: 'pipe' });
    console.log('✓ Wrangler CLI OK');
  } catch {
    console.log('✗ 需要安裝 wrangler: npm install -g wrangler');
    console.log('  然後執行: wrangler login');
    process.exit(1);
  }

  console.log('\n--- 第一步：API Keys ---\n');

  const newsApiKey = await ask('NewsAPI.org API Key (https://newsapi.org/register): ');
  const claudeApiKey = await ask('Anthropic Claude API Key (https://console.anthropic.com): ');
  const alphaVantageKey = await ask('Alpha Vantage Key (https://www.alphavantage.co/support/#api-key, 可按 Enter 跳過): ');
  const refreshToken = await ask('自訂 refresh token（用於手動觸發更新，可隨意設定）: ');

  console.log('\n--- 第二步：建立 Cloudflare KV ---\n');
  console.log('正在建立 KV namespace...');

  let kvId = '';
  try {
    const output = execSync('cd worker && npx wrangler kv namespace create DASHBOARD_KV', { encoding: 'utf-8' });
    const match = output.match(/id\s*=\s*"([^"]+)"/);
    if (match) {
      kvId = match[1];
      console.log(`✓ KV namespace 建立成功: ${kvId}`);
    }
  } catch (err) {
    console.log('⚠ 自動建立 KV 失敗，請手動執行:');
    console.log('  cd worker && npx wrangler kv namespace create DASHBOARD_KV');
    kvId = await ask('請貼上 KV namespace ID: ');
  }

  // Update wrangler.toml
  if (kvId) {
    let toml = fs.readFileSync('worker/wrangler.toml', 'utf-8');
    toml = toml.replace('YOUR_KV_NAMESPACE_ID', kvId);
    fs.writeFileSync('worker/wrangler.toml', toml);
    console.log('✓ wrangler.toml 已更新 KV ID');
  }

  console.log('\n--- 第三步：設定 Worker Secrets ---\n');

  const secrets = {
    NEWS_API_KEY: newsApiKey,
    CLAUDE_API_KEY: claudeApiKey,
    REFRESH_TOKEN: refreshToken || 'default-refresh-token',
  };
  if (alphaVantageKey) secrets.ALPHA_VANTAGE_KEY = alphaVantageKey;

  for (const [key, value] of Object.entries(secrets)) {
    if (!value) continue;
    try {
      execSync(`cd worker && echo "${value}" | npx wrangler secret put ${key}`, { stdio: 'pipe' });
      console.log(`✓ ${key} 已設定`);
    } catch {
      console.log(`⚠ 無法自動設定 ${key}，請手動執行:`);
      console.log(`  cd worker && npx wrangler secret put ${key}`);
    }
  }

  console.log('\n--- 第四步：部署 ---\n');

  const deploy = await ask('是否立即部署？(y/n): ');
  if (deploy.toLowerCase() === 'y') {
    console.log('\n部署 Cloudflare Worker...');
    try {
      execSync('cd worker && npx wrangler deploy', { stdio: 'inherit' });
      console.log('✓ Worker 部署成功');
    } catch {
      console.log('⚠ Worker 部署失敗，請手動執行: cd worker && npx wrangler deploy');
    }

    console.log('\n部署靜態網站到 Cloudflare Pages...');
    try {
      execSync('npx wrangler pages deploy public --project-name=vip-dashboard', { stdio: 'inherit' });
      console.log('✓ Pages 部署成功');
    } catch {
      console.log('⚠ Pages 部署失敗，請手動執行: npx wrangler pages deploy public --project-name=vip-dashboard');
    }
  }

  console.log('\n==========================================');
  console.log('  設定完成！');
  console.log('==========================================');
  console.log('\n下一步：');
  console.log('1. 前往 https://dash.cloudflare.com 查看部署狀態');
  console.log('2. 記得更新 public/index.html 中的 WORKER_API 變數');
  console.log('3. 設定 GitHub Secrets 以啟用 Pionex 自動抓取');
  console.log('   - CF_ACCOUNT_ID: 你的 Cloudflare Account ID');
  console.log('   - KV_NAMESPACE_ID: ' + (kvId || '你的 KV namespace ID'));
  console.log('   - CF_API_TOKEN: 在 Cloudflare 建立 API Token (需 KV 寫入權限)');
  console.log('');

  rl.close();
}

main().catch(err => {
  console.error('Error:', err.message);
  rl.close();
  process.exit(1);
});
