#!/usr/bin/env node
// scripts/generate-test-keys.js
// Generates test VERA Pro license keys for local testing
// Usage: node scripts/generate-test-keys.js [count]
// Example: node scripts/generate-test-keys.js 5

require('dotenv').config({ path: '.env.local' });
const crypto = require('crypto');

const SIGNING_SECRET = process.env.LICENSE_SIGNING_SECRET || 'dev-test-secret-change-in-prod';
const count = parseInt(process.argv[2] || '3', 10);

function generateLicenseKey(discordUserId, subscriptionId, daysValid = 30) {
  const expiresAt = Math.floor(Date.now() / 1000) + daysValid * 24 * 60 * 60;

  const payload = {
    uid: discordUserId,
    sub: subscriptionId,
    exp: expiresAt,
    tier: 'pro',
    issued: Date.now(),
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');

  const signature = crypto
    .createHmac('sha256', SIGNING_SECRET)
    .update(payloadB64)
    .digest('base64url');

  return `VERA-PRO-${payloadB64}.${signature}`;
}

function decodeKey(key) {
  try {
    const stripped = key.replace('VERA-PRO-', '');
    const dotIdx = stripped.lastIndexOf('.');
    const payloadB64 = stripped.substring(0, dotIdx);
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    return {
      ...payload,
      expiry_date: new Date(payload.exp * 1000).toISOString(),
      issued_date: new Date(payload.issued).toISOString(),
    };
  } catch {
    return null;
  }
}

console.log('\n🔑 VERA Pro — Test License Key Generator');
console.log('━'.repeat(60));
console.log(`Signing secret: ${SIGNING_SECRET === 'dev-test-secret-change-in-prod' ? '⚠️  Using default dev secret' : '✅ Custom secret loaded'}`);
console.log(`Generating ${count} key(s)...\n`);

for (let i = 1; i <= count; i++) {
  const fakeDiscordId = `discord_test_${crypto.randomBytes(4).toString('hex')}`;
  const fakeSubId = `sub_test_${crypto.randomBytes(8).toString('hex')}`;
  const key = generateLicenseKey(fakeDiscordId, fakeSubId, 30);
  const decoded = decodeKey(key);

  console.log(`Key ${i}:`);
  console.log(`  ${key}`);
  console.log(`  Discord ID: ${decoded.uid}`);
  console.log(`  Expires:    ${decoded.expiry_date}`);
  console.log(`  Tier:       ${decoded.tier}`);
  console.log('');
}

console.log('━'.repeat(60));
console.log('✅ Done. These keys are for local testing only.');
console.log('⚠️  Production keys are generated automatically by the Stripe webhook.\n');
