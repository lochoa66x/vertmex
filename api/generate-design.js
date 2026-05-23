// ============================================================
// Vertmex — AI Design Generator (Photo Mode)
// File: api/generate-design.js
// Place this file in the /api folder at the root of your project
// ============================================================
//
// NOTE: This function only handles PHOTO MODE (image transformation).
// Text mode uses Pollinations.ai directly in the browser — free,
// no API key needed, nothing to configure.
//
// This function runs on Vercel's servers (not in the browser).
// It receives the user's uploaded yard photo, calls the Replicate
// AI service, and returns a transformed landscaping image.
//
// SETUP REQUIRED (photo mode only):
//   Add REPLICATE_API_TOKEN to your Vercel environment variables
//   (see SETUP.md for step-by-step instructions)
//   Cost: ~$0.05 per photo transformation
// ============================================================

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '6mb',
    },
  },
};

const STYLE_PROMPTS = {
  'Moderne minimaliste':            'modern minimalist landscaping, clean lines, geometric shapes, ornamental grasses, concrete accents',
  'Traditionnel / classique':       'traditional classic formal garden, symmetrical beds, rose bushes, neat hedges, brick pathways',
  'Champêtre / naturel':            'rustic cottage garden, wildflowers, natural stone, wooden elements, organic flowing shapes',
  'Zen / japonais':                 'zen japanese garden, bamboo, raked gravel, stone lanterns, moss, peaceful and serene',
  'Méditerranéen':                  'mediterranean garden, lavender, olive trees, terracotta pots, drought-resistant plants, warm tones',
  'Plantes indigènes / écologique': 'native plants ecological garden, Quebec native species, naturalized, sustainable, low maintenance',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.REPLICATE_API_TOKEN) {
    console.error('REPLICATE_API_TOKEN is not set in environment variables');
    return res.status(500).json({ error: 'Service not configured. Contact the site administrator.' });
  }

  const { style, prompt, image } = req.body;

  if (!image) {
    return res.status(400).json({ error: 'No image provided. Text mode uses Pollinations directly.' });
  }

  const styleDesc = STYLE_PROMPTS[style] || 'professional landscaping';
  const userDetails = prompt ? `, ${prompt}` : '';

  const fullPrompt = [
    `Professional residential ${styleDesc}${userDetails}`,
    'beautiful manicured garden in Quebec, Canada',
    'photorealistic architectural visualization',
    'lush green plants, colourful flowers, stone pathway',
    'golden hour lighting, high quality, 8K',
  ].join(', ');

  const negativePrompt = [
    'ugly, blurry, deformed, distorted, low quality',
    'people, cars, vehicles, interior, indoors',
    'watermark, text, logo, oversaturated',
  ].join(', ');

  const modelInput = {
    prompt: fullPrompt,
    negative_prompt: negativePrompt,
    image: image,
    prompt_strength: 0.65,
    width: 1024,
    height: 768,
    num_inference_steps: 30,
    guidance_scale: 7.5,
  };

  try {
    const response = await fetch(
      'https://api.replicate.com/v1/models/stability-ai/sdxl/predictions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
          'Content-Type': 'application/json',
          Prefer: 'wait=55',
        },
        body: JSON.stringify({ input: modelInput }),
      }
    );

    const prediction = await response.json();

    if (!response.ok) {
      console.error('Replicate API error:', prediction);
      return res.status(response.status).json({
        error: prediction.detail || 'AI service error. Please try again.',
      });
    }

    if (prediction.status === 'succeeded') {
      const imageUrl = Array.isArray(prediction.output)
        ? prediction.output[0]
        : prediction.output;
      return res.status(200).json({ imageUrl, status: 'succeeded' });
    }

    if (prediction.status === 'failed') {
      console.error('Prediction failed:', prediction.error);
      return res.status(500).json({ error: 'Generation failed. Please try again.' });
    }

    return res.status(202).json({
      id: prediction.id,
      status: prediction.status,
    });

  } catch (err) {
    console.error('Unexpected error in generate-design:', err);
    return res.status(500).json({ error: 'Unexpected error. Please try again.' });
  }
}
