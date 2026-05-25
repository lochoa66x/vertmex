export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

const DEFAULT_REPO = 'lochoa66x/vertmex';
const DEFAULT_BRANCH = 'main';

function sendJson(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json');
  return res.end(JSON.stringify(body));
}

function slugify(value) {
  return String(value || 'projet')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 54) || 'projet';
}

function imageFromDataUrl(dataUrl, label) {
  const match = /^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/i.exec(dataUrl || '');
  if (!match) throw new Error(`${label} must be a JPG, PNG or WebP image.`);

  const mimeExt = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
  return {
    ext: mimeExt,
    content: match[2],
  };
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

  if (!response.ok) {
    throw new Error(data?.message || `GitHub request failed with ${response.status}`);
  }

  return data;
}

async function getFile(repo, branch, path) {
  return githubRequest(`/repos/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}?ref=${encodeURIComponent(branch)}`);
}

async function putFile(repo, branch, path, content, message, sha) {
  const body = {
    branch,
    message,
    content,
  };
  if (sha) body.sha = sha;

  return githubRequest(`/repos/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  const requiredEnv = ['GITHUB_TOKEN', 'OWNER_UPLOAD_PASSWORD'];
  const missing = requiredEnv.filter((key) => !process.env[key]);
  if (missing.length) {
    return sendJson(res, 500, { error: `Missing server setting: ${missing.join(', ')}` });
  }

  const {
    password,
    title,
    category,
    city,
    description,
    beforeImage,
    afterImage,
  } = req.body || {};

  if (password !== process.env.OWNER_UPLOAD_PASSWORD) {
    return sendJson(res, 401, { error: 'Invalid password' });
  }

  if (!title || !beforeImage || !afterImage) {
    return sendJson(res, 400, { error: 'Title, before image and after image are required.' });
  }

  const repo = process.env.GITHUB_REPO || DEFAULT_REPO;
  const branch = process.env.GITHUB_BRANCH || DEFAULT_BRANCH;
  const timestamp = new Date().toISOString();
  const slug = `${timestamp.slice(0, 10)}-${slugify(title)}`;

  try {
    const before = imageFromDataUrl(beforeImage, 'Before image');
    const after = imageFromDataUrl(afterImage, 'After image');
    const beforePath = `assets/projects/owner/${slug}-before.${before.ext}`;
    const afterPath = `assets/projects/owner/${slug}-after.${after.ext}`;

    await putFile(repo, branch, beforePath, before.content, `Add before photo for ${title}`);
    await putFile(repo, branch, afterPath, after.content, `Add after photo for ${title}`);

    const projectsFile = await getFile(repo, branch, 'projects.json');
    const currentProjects = projectsFile?.content
      ? JSON.parse(Buffer.from(projectsFile.content, 'base64').toString('utf8'))
      : [];

    const project = {
      id: slug,
      title: String(title).trim(),
      category: String(category || 'Projet récent').trim(),
      city: String(city || 'Montérégie').trim(),
      description: String(description || 'Photos avant / après fournies par VertMex.').trim(),
      beforeImage: beforePath,
      afterImage: afterPath,
      createdAt: timestamp,
    };

    const nextProjects = [project, ...currentProjects].slice(0, 12);
    const projectsContent = Buffer.from(`${JSON.stringify(nextProjects, null, 2)}\n`).toString('base64');
    await putFile(repo, branch, 'projects.json', projectsContent, `Add owner project ${title}`, projectsFile?.sha);

    return sendJson(res, 200, { ok: true, project });
  } catch (error) {
    return sendJson(res, 500, { error: error.message || 'Upload failed.' });
  }
}
