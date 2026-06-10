export const config = {
  api: {
    bodyParser: {
      sizeLimit: '8mb',
    },
  },
};

const DEFAULT_MODEL = 'gpt-4.1-mini';

const schemaExample = {
  identification: 'Common name and likely scientific name if useful',
  confidence: 'High / Medium / Low',
  category: 'Tree / shrub / weed / vine / lawn issue / unknown',
  overallAssessment: 'Beneficial / neutral / invasive / harmful / risky / unclear',
  riskLevel: 'Low / Watch / Risk / Possible toxic plant',
  toxicWarning: 'Mention poison ivy or toxicity only when relevant; otherwise say no clear toxic warning visible',
  visibleIssues: 'Visible pests, disease, dryness, damage, poor soil, or unclear',
  recommendation: 'Practical next step for a homeowner and landscaper',
  disclaimer: 'Short safety disclaimer',
};

function sendCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function extractOutputText(responseJson) {
  if (typeof responseJson.output_text === 'string') return responseJson.output_text;
  const chunks = [];
  for (const item of responseJson.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === 'string') chunks.push(content.text);
    }
  }
  return chunks.join('\n').trim();
}

function parseJsonText(text) {
  const cleaned = String(text || '').trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('The AI response was not valid JSON.');
  }
}

function normalizeResult(result, language) {
  const fallbackDisclaimer = language === 'en'
    ? 'Indicative analysis only. Do not touch a suspicious plant. For toxic plants, allergies, mushrooms, or health risks, confirm with a local professional.'
    : 'Analyse indicative seulement. Ne touchez pas une plante suspecte. Pour les plantes toxiques, allergies, champignons ou risques de santé, confirmez avec un professionnel local.';

  return {
    identification: result.identification || (language === 'en' ? 'Unclear from photo' : 'À confirmer avec une photo plus claire'),
    confidence: result.confidence || (language === 'en' ? 'Low' : 'Faible'),
    category: result.category || (language === 'en' ? 'Unknown' : 'Inconnue'),
    overallAssessment: result.overallAssessment || result.assessment || (language === 'en' ? 'Unclear' : 'À confirmer'),
    riskLevel: result.riskLevel || (language === 'en' ? 'Watch' : 'À surveiller'),
    toxicWarning: result.toxicWarning || (language === 'en' ? 'No clear toxic warning visible from this photo.' : 'Aucun signe toxique évident visible sur cette photo.'),
    visibleIssues: result.visibleIssues || (language === 'en' ? 'No visible issue confirmed from this photo.' : 'Aucun problème visible confirmé avec cette photo.'),
    recommendation: result.recommendation || (language === 'en' ? 'Take a clearer photo and confirm on site before touching or removing it.' : 'Prenez une photo plus claire et confirmez sur place avant de toucher ou retirer la plante.'),
    disclaimer: result.disclaimer || fallbackDisclaimer,
  };
}

export default async function handler(req, res) {
  sendCors(res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({
      error: 'Plant analysis is not configured yet. Add OPENAI_API_KEY in Vercel environment variables.',
    });
  }

  const { image, question = '', language = 'fr' } = req.body || {};

  if (!image || typeof image !== 'string' || !image.startsWith('data:image/')) {
    return res.status(400).json({ error: 'A valid image is required.' });
  }

  const outputLanguage = language === 'en' ? 'English' : 'French';
  const prompt = `
You are helping a local landscaping company in Quebec give practical plant guidance from a customer photo.

Analyze the image and answer in ${outputLanguage}.

User question:
${question || 'No specific question provided.'}

Return ONLY valid JSON with these exact keys:
${JSON.stringify(schemaExample, null, 2)}

Rules:
- Be useful for homeowners and landscapers, not academic.
- If the photo is unclear, say so and lower confidence.
- Do not claim certainty about poison ivy, toxic plants, mushrooms, allergies, or health risks.
- If poison ivy or another risky plant is possible, say "possible" and recommend not touching it.
- Do not provide medical advice.
- Do not invent local certifications, legal claims, or guaranteed identification.
- Keep each field short, practical, and easy to display in a card.
`;

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENAI_PLANT_MODEL || DEFAULT_MODEL,
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: prompt },
              { type: 'input_image', image_url: image, detail: 'low' },
            ],
          },
        ],
        max_output_tokens: 900,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('OpenAI plant analysis error:', data);
      return res.status(response.status).json({
        error: data.error?.message || 'Plant analysis failed. Please try again.',
      });
    }

    const outputText = extractOutputText(data);
    const parsed = parseJsonText(outputText);
    return res.status(200).json(normalizeResult(parsed, language));
  } catch (error) {
    console.error('Unexpected plant analysis error:', error);
    return res.status(500).json({
      error: 'Unexpected error while analyzing the plant. Please try again.',
    });
  }
}
