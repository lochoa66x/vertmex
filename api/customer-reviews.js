const DEFAULT_REPO = 'lochoa66x/vertmex';
const DEFAULT_BRANCH = 'main';
const PENDING_FILE = 'pending-reviews.json';

function sendJson(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json');
  return res.end(JSON.stringify(body));
}

function clean(value, max = 500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function makeId() {
  return `review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function githubRequest(path, options = {}) {
  const token = process.env.GITHUB_TOKEN;
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {}),
    },
  });

  if (response.status === 404) return null;

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.message || `GitHub request failed with ${response.status}`);
  return data;
}

async function getFile(repo, branch, path) {
  return githubRequest(`/repos/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}?ref=${encodeURIComponent(branch)}`);
}

async function putFile(repo, branch, path, content, message, sha) {
  const body = { branch, message, content };
  if (sha) body.sha = sha;
  return githubRequest(`/repos/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

function parseJsonFile(file, fallback) {
  if (!file?.content) return fallback;
  return JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  if (!process.env.GITHUB_TOKEN) return sendJson(res, 500, { error: 'Missing server setting: GITHUB_TOKEN' });

  const { name, city, service, rating, text, website } = req.body || {};
  if (website) return sendJson(res, 200, { ok: true });

  const cleanName = clean(name, 80);
  const cleanText = clean(text, 700);
  const cleanCity = clean(city, 80);
  const cleanService = clean(service, 100);
  const numericRating = Math.max(1, Math.min(5, Number.parseInt(rating, 10) || 5));

  if (!cleanName || cleanName.length < 2) return sendJson(res, 400, { error: 'Name is required.' });
  if (!cleanText || cleanText.length < 12) return sendJson(res, 400, { error: 'Review is too short.' });

  const repo = process.env.GITHUB_REPO || DEFAULT_REPO;
  const branch = process.env.GITHUB_BRANCH || DEFAULT_BRANCH;

  try {
    const pendingFile = await getFile(repo, branch, PENDING_FILE);
    const pending = parseJsonFile(pendingFile, []);
    const review = {
      id: makeId(),
      name: cleanName,
      city: cleanCity,
      service: cleanService,
      rating: numericRating,
      text: cleanText,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    const nextPending = [review, ...pending].slice(0, 80);
    const content = Buffer.from(`${JSON.stringify(nextPending, null, 2)}\n`).toString('base64');
    await putFile(repo, branch, PENDING_FILE, content, `Add pending review from ${cleanName}`, pendingFile?.sha);

    return sendJson(res, 200, { ok: true });
  } catch (error) {
    return sendJson(res, 500, { error: error.message || 'Review submission failed.' });
  }
}
