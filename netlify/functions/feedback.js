// netlify/functions/feedback.js

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
    const { app, rating, message, version } = data;

    console.log(`[FEEDBACK SUBMISSION] App: ${app} | Version: ${version} | Rating: ${rating} stars`);

    const webhookUrl = process.env.DISCORD_FEEDBACK_WEBHOOK || process.env.DISCORD_WEBHOOK_URL;
    if (webhookUrl) {
      const starRating = rating > 0 ? '⭐'.repeat(rating) : 'None';
      
      // Select embed color: green for 4-5 stars, yellow for 3, red for 1-2 stars, purple default
      let color = 10181046; // Purple
      if (rating >= 4) color = 3066993; // Green
      else if (rating === 3) color = 15844367; // Yellow
      else if (rating > 0 && rating <= 2) color = 15158332; // Red

      const embed = {
        title: `⭐ New User Feedback: ${app}`,
        color: color,
        fields: [
          { name: 'App Tier / Name', value: app || 'VERA Freeware', inline: true },
          { name: 'App Version', value: version || '1.0.0', inline: true },
          { name: 'Rating', value: `${starRating} (${rating || 0}/5)`, inline: false },
          { name: 'Message', value: message ? `\`\`\`${message}\`\`\`` : '*No message provided*', inline: false }
        ],
        timestamp: new Date().toISOString()
      };

      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embeds: [embed] })
      }).catch(err => console.error('Failed to send feedback to Discord:', err));
    } else {
      console.warn('Warning: Webhook environment variable not configured.');
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ status: 'success' })
    };
  } catch (err) {
    console.error('Error handling feedback submission:', err);
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid Request Body' })
    };
  }
};
