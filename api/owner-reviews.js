const DEFAULT_REPO = 'lochoa66x/vertmex';
const DEFAULT_BRANCH = 'main';
const PENDING_FILE = 'pending-reviews.json';
const REVIEWS_FILE = 'reviews.json';

function sendJson(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json');
  return res.end(JSON.stringify(body));
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

function encodeJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`).toString('base64');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  const missing = ['GITHUB_TOKEN', 'OWNER_UPLOAD_PASSWORD'].filter((key) => !process.env[key]);
  if (missing.length) return sendJson(res, 500, { error: `Missing server setting: ${missing.join(', ')}` });

  const { password, action, id } = req.body || {};
  if (password !== process.env.OWNER_UPLOAD_PASSWORD) return sendJson(res, 401, { error: 'Invalid password' });

  const repo = process.env.GITHUB_REPO || DEFAULT_REPO;
  const branch = process.env.GITHUB_BRANCH || DEFAULT_BRANCH;

  try {
    const pendingFile = await getFile(repo, branch, PENDING_FILE);
    const reviewsFile = await getFile(repo, branch, REVIEWS_FILE);
    const pending = parseJsonFile(pendingFile, []);
    const reviews = parseJsonFile(reviewsFile, []);

    if (action === 'list') {
      return sendJson(res, 200, { ok: true, pending, reviews });
    }

    const review = pending.find((item) => item.id === id);
    if (!review) return sendJson(res, 404, { error: 'Review not found.' });

    const nextPending = pending.filter((item) => item.id !== id);

    if (action === 'reject') {
      await putFile(repo, branch, PENDING_FILE, encodeJson(nextPending), `Reject review from ${review.name}`, pendingFile?.sha);
      return sendJson(res, 200, { ok: true, pending: nextPending });
    }

    if (action === 'approve') {
      const approved = {
        id: review.id,
        name: review.name,
        city: review.city,
        service: review.service,
        rating: review.rating,
        text: review.text,
        source: 'Client',
        approvedAt: new Date().toISOString(),
      };
      const nextReviews = [approved, ...reviews].slice(0, 24);
      await putFile(repo, branch, PENDING_FILE, encodeJson(nextPending), `Approve review cleanup ${review.name}`, pendingFile?.sha);
      await putFile(repo, branch, REVIEWS_FILE, encodeJson(nextReviews), `Approve review from ${review.name}`, reviewsFile?.sha);
      return sendJson(res, 200, { ok: true, review: approved, pending: nextPending, reviews: nextReviews });
    }

    return sendJson(res, 400, { error: 'Unknown review action.' });
  } catch (error) {
    return sendJson(res, 500, { error: error.message || 'Review action failed.' });
  }
}
