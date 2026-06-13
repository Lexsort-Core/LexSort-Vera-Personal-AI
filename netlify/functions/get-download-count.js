// netlify/functions/get-download-count.js
// Fetches and caches the total download stats of VERA Freeware from GitHub Releases API
// Uses in-memory caching to avoid hitting GitHub API rate limits (50/hr for unauthenticated calls)

const CACHE_DURATION = 60 * 60 * 1000; // Cache for 1 hour
let cachedData = null;
let cacheTimestamp = null;

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=3600' // Allow browser caching for 1 hour
  };

  // Handle preflight OPTIONS request
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  // Only allow GET requests
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  // Check for force refresh parameter (admin use only)
  const forceRefresh = event.queryStringParameters?.force === 'true';
  const adminToken = event.queryStringParameters?.token;
  const isValidAdmin = adminToken && adminToken === process.env.ADMIN_REFRESH_TOKEN;

  if (forceRefresh && isValidAdmin) {
    console.log('🔄 Force refresh requested by admin, clearing cache...');
    cachedData = null;
    cacheTimestamp = null;
  }

  // Check if we have valid cached data
  const now = Date.now();
  if (cachedData && cacheTimestamp && (now - cacheTimestamp) < CACHE_DURATION) {
    console.log('📦 Returning cached data (age:', Math.round((now - cacheTimestamp) / 1000), 'seconds)');
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ...cachedData,
        cached: true,
        cache_age_seconds: Math.round((now - cacheTimestamp) / 1000)
      })
    };
  }

  console.log('🔄 Cache expired or empty, fetching fresh data from GitHub...');

  const REPO_OWNER = 'Lexsort-Core';
  const REPO_NAME = 'LexSort-Vera-Personal-AI';

  try {
    // Fetch all releases from GitHub API
    const response = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases?per_page=100`,
      {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          ...(process.env.GITHUB_TOKEN && {
            'Authorization': `token ${process.env.GITHUB_TOKEN}`
          })
        }
      }
    );

    if (!response.ok) {
      const remaining = response.headers.get('X-RateLimit-Remaining');
      const reset = response.headers.get('X-RateLimit-Reset');
      
      if (remaining === '0') {
        const resetDate = new Date(parseInt(reset) * 1000);
        throw new Error(`GitHub API rate limit exceeded. Resets at ${resetDate.toLocaleTimeString()}`);
      }
      
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const releases = await response.json();
    
    // Process the data
    let totalDownloads = 0;
    let releaseStats = [];

    for (const release of releases) {
      let releaseDownloads = 0;
      const assets = [];

      for (const asset of release.assets) {
        const downloadCount = asset.download_count;
        releaseDownloads += downloadCount;
        totalDownloads += downloadCount;
        
        assets.push({
          name: asset.name,
          downloads: downloadCount,
          size: asset.size,
          created_at: asset.created_at,
          browser_download_url: asset.browser_download_url
        });
      }

      releaseStats.push({
        tag: release.tag_name,
        name: release.name,
        published_at: release.published_at,
        total_downloads: releaseDownloads,
        assets: assets,
        is_prerelease: release.prerelease,
        is_latest: (releases.indexOf(release) === 0) // First release is latest
      });
    }

    // Prepare response data
    const responseData = {
      repository: `${REPO_OWNER}/${REPO_NAME}`,
      last_updated: new Date().toISOString(),
      total_downloads: totalDownloads,
      total_releases: releaseStats.length,
      rate_limit_protected: true,
      cache_duration_hours: CACHE_DURATION / (60 * 60 * 1000),
      releases: releaseStats,
      summary: {
        total_windows_downloads: releaseStats.reduce((sum, release) => 
          sum + release.assets.filter(a => a.name.endsWith('.msi') || a.name.endsWith('.exe')).reduce((s, a) => s + a.downloads, 0), 0),
        total_macos_downloads: releaseStats.reduce((sum, release) => 
          sum + release.assets.filter(a => a.name.endsWith('.dmg')).reduce((s, a) => s + a.downloads, 0), 0),
        total_linux_downloads: releaseStats.reduce((sum, release) => 
          sum + release.assets.filter(a => a.name.endsWith('.AppImage') || a.name.endsWith('.deb')).reduce((s, a) => s + a.downloads, 0), 0)
      }
    };

    // Update cache
    cachedData = responseData;
    cacheTimestamp = now;

    console.log(`✅ Fetched fresh data: ${totalDownloads} total downloads across ${releaseStats.length} releases`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(responseData)
    };
  } catch (error) {
    console.error('Error fetching GitHub releases:', error);
    
    // Return cached data if available (even if expired/stale)
    if (cachedData) {
      console.log('⚠️ API error, returning stale cached data');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          ...cachedData,
          cached: true,
          stale: true,
          error_message: error.message
        })
      };
    }
    
    // No cache available, return error
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to fetch download counts',
        message: error.message
      })
    };
  }
};
