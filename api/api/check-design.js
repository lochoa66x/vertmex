// ============================================================
// Vertmex — AI Design Status Checker
// File: api/check-design.js
// Place this file in the /api folder at the root of your project
// ============================================================
//
// The browser calls this every 2 seconds to check whether the AI
// has finished generating the image (used as a fallback when
// generate-design.js doesn't return the image in time).
// ============================================================

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ error: 'Missing prediction ID' });
  }

  if (!process.env.REPLICATE_API_TOKEN) {
    return res.status(500).json({ error: 'Service not configured.' });
  }

  try {
    const response = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
      headers: {
        Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
      },
    });

    const prediction = await response.json();

    if (prediction.status === 'succeeded') {
      const imageUrl = Array.isArray(prediction.output)
        ? prediction.output[0]
        : prediction.output;
      return res.status(200).json({ imageUrl, status: 'succeeded' });
    }

    if (prediction.status === 'failed') {
      return res.status(500).json({ error: 'Generation failed. Please try again.', status: 'failed' });
    }

    // Still processing — browser will check again in 2 seconds
    return res.status(200).json({ status: prediction.status, id });

  } catch (err) {
    console.error('check-design error:', err);
    return res.status(500).json({ error: err.message });
  }
}
