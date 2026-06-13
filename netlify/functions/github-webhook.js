// netlify/functions/github-webhook.js
// Handles GitHub webhook events to invalidate the download count cache when a new release ships
// Supports signature verification for security

const crypto = require('crypto');

// Secret to verify webhook comes from GitHub (configured in Netlify environment)
const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  // Only allow POST from GitHub
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Verify webhook signature for security
  if (WEBHOOK_SECRET) {
    const signature = event.headers['x-hub-signature-256'];
    if (!signature) {
      console.error('❌ Missing signature header');
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized: Missing signature' }) };
    }
    
    if (!verifySignature(event.body, signature, WEBHOOK_SECRET)) {
      console.error('❌ Invalid webhook signature');
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized: Invalid signature' }) };
    }
  }

  const payload = JSON.parse(event.body || '{}');
  const eventType = event.headers['x-github-event'];

  console.log(`📨 Received GitHub event: ${eventType}`);

  // We are interested in release events (published, edited, deleted)
  if (eventType === 'release') {
    const action = payload.action;
    console.log(`📦 Release action: ${action}`);
    
    if (['published', 'edited', 'deleted', 'prereleased'].includes(action)) {
      await clearCache(action, payload.release?.tag_name);
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          message: 'Cache clear triggered successfully',
          event: eventType,
          action: action,
          release: payload.release?.tag_name
        })
      };
    }
  }

  // Also clear on push if it modifies release-related files
  if (eventType === 'push') {
    const affectedPaths = payload.commits?.flatMap(c => c.added.concat(c.modified).concat(c.removed)) || [];
    const isReleaseModified = affectedPaths.some(path => 
      path.includes('release.yml') || 
      path.includes('tauri.conf.json') ||
      path.includes('package.json')
    );
    
    if (isReleaseModified) {
      await clearCache('push_release_files');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ message: 'Cache clear triggered via repository push' })
      };
    }
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ message: 'Event received but no action required' })
  };
};

async function clearCache(reason, tag = null) {
  console.log(`🧹 Clearing cache due to: ${reason}${tag ? ` (${tag})` : ''}`);

  // Redis Cache Clearing (if credentials are set in environment)
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    try {
      const { Redis } = require('@upstash/redis');
      const redis = Redis.fromEnv();
      await redis.del('github_download_stats');
      console.log('🗑️ Redis cache invalidated.');
    } catch (err) {
      console.error('Failed to clear Redis cache:', err.message);
    }
  }

  // Pre-warm cache by triggering a fetch request to the main endpoint
  try {
    // Determine the base URL (fallback to localhost for dev)
    const siteUrl = process.env.URL || 'http://localhost:8888';
    // Fire and forget
    fetch(`${siteUrl}/.netlify/functions/get-download-count`, { method: 'GET' })
      .then(() => console.log('🔥 Cache pre-warmed.'))
      .catch((e) => console.warn('Pre-warm request error:', e.message));
  } catch (err) {
    console.warn('Could not launch pre-warm task:', err.message);
  }
}

function verifySignature(body, signature, secret) {
  const hash = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');
  
  const trusted = Buffer.from(`sha256=${hash}`, 'ascii');
  const untrusted = Buffer.from(signature, 'ascii');
  
  return crypto.timingSafeEqual(trusted, untrusted);
}
