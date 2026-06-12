// netlify/functions/download-attempt.js

exports.handler = async (event, context) => {
  // Enable CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  try {
    const data = JSON.parse(event.body);
    const { filename, success, error, user_agent, platform, referrer, timestamp } = data;

    console.log(`[DOWNLOAD ATTEMPT] File: ${filename} | Success: ${success} | OS: ${platform} | UA: ${user_agent}`);

    // Optional: Send to Discord Webhook
    const discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (discordWebhookUrl) {
      const statusEmoji = success ? '✅' : '❌';
      const embed = {
        title: `${statusEmoji} Download Attempt: ${filename}`,
        color: success ? 3066993 : 15158332, // green or red
        fields: [
          { name: 'File', value: filename || 'unknown', inline: true },
          { name: 'Platform', value: platform || 'unknown', inline: true },
          { name: 'Referrer', value: referrer || 'none', inline: false },
          { name: 'User-Agent', value: user_agent || 'unknown', inline: false }
        ],
        timestamp: timestamp || new Date().toISOString()
      };

      if (error) {
        embed.fields.push({ name: 'Error', value: error, inline: false });
      }

      await fetch(discordWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embeds: [embed] })
      }).catch(err => console.error('Failed to send to Discord:', err));
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ status: 'success' })
    };
  } catch (err) {
    console.error('Error handling download attempt:', err);
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid Request Body' })
    };
  }
};
