require('dotenv').config();
const express = require('express');
const OpenAI = require('openai');
const path = require('path');

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));
const MODEL = process.env.OPENAI_MODEL || 'gpt-5.1-codex-mini';

// Lazy-init: avoids crash at import time when OPENAI_API_KEY isn't set yet (Vercel cold starts)
let _openai;
function getClient() {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

const REVIEW_SCHEMA = {
  type: 'json_schema',
  name: 'code_review_result',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      recommendation: {
        type: 'string',
        enum: ['approve', 'approve_with_changes', 'request_changes']
      },
      findings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
            category: { type: 'string', enum: ['security', 'logic', 'performance', 'style', 'documentation'] },
            file: { type: 'string' },
            line_reference: { type: 'string' },
            finding: { type: 'string' },
            suggestion: { type: 'string' }
          },
          required: ['severity', 'category', 'file', 'line_reference', 'finding', 'suggestion'],
          additionalProperties: false
        }
      }
    },
    required: ['summary', 'recommendation', 'findings'],
    additionalProperties: false
  }
};

const INSTRUCTIONS = `You are a senior software engineer performing a thorough code review.
Analyze the PR diff for: security vulnerabilities, logic errors, performance issues,
style violations, and missing error handling. Be specific — reference file names and
line numbers where possible. Prioritize security findings.
When you encounter a dependency, API pattern, or code construct that may have known
vulnerabilities or CVEs, use web search to check for current security advisories.`;

async function reviewDiff(diff) {
  const start = Date.now();

  const response = await getClient().responses.create({
    model: MODEL,
    instructions: INSTRUCTIONS,
    input: `Review this PR diff:\n\n${diff}`,
    tools: [{ type: 'web_search_preview' }],
    text: {
      format: REVIEW_SCHEMA
    }
  });

  const elapsed = Date.now() - start;
  const result = JSON.parse(response.output_text);
  return { result, elapsed };
}

// Review a pasted diff
app.post('/api/review', async (req, res) => {
  const start = Date.now();
  const { diff } = req.body;

  if (!diff || typeof diff !== 'string' || diff.trim().length === 0) {
    return res.status(400).json({ error: 'Missing or empty diff in request body' });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY is not configured on the server' });
  }

  try {
    console.log(`[review] Received diff (${diff.length} chars) using model ${MODEL}`);
    const { result, elapsed } = await reviewDiff(diff);
    console.log(`[review] Completed in ${elapsed}ms — ${result.findings.length} findings`);
    return res.json({ ...result, elapsed_ms: elapsed });
  } catch (err) {
    console.error(`[review] Error after ${Date.now() - start}ms:`, err.message);
    const status = err.status || 500;
    return res.status(status).json({ error: err.message });
  }
});

// Review a GitHub PR URL
app.post('/api/review-url', async (req, res) => {
  const start = Date.now();
  const { url } = req.body;

  if (!url || typeof url !== 'string' || url.trim().length === 0) {
    return res.status(400).json({ error: 'Missing or empty URL in request body' });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY is not configured on the server' });
  }

  // Validate and normalize the GitHub PR URL
  const prMatch = url.trim().match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/
  );
  if (!prMatch) {
    return res.status(400).json({ error: 'Invalid GitHub PR URL. Expected format: https://github.com/owner/repo/pull/123' });
  }

  const diffUrl = `https://github.com/${prMatch[1]}/${prMatch[2]}/pull/${prMatch[3]}.diff`;

  try {
    console.log(`[review-url] Fetching diff from ${diffUrl}`);
    const diffRes = await fetch(diffUrl, {
      headers: { Accept: 'text/plain' }
    });

    if (!diffRes.ok) {
      const msg = diffRes.status === 404
        ? 'PR not found — make sure the repository is public'
        : `GitHub returned ${diffRes.status}`;
      return res.status(diffRes.status).json({ error: msg });
    }

    const diff = await diffRes.text();
    if (!diff || diff.trim().length === 0) {
      return res.status(400).json({ error: 'PR diff is empty' });
    }

    console.log(`[review-url] Fetched diff (${diff.length} chars), sending to OpenAI with model ${MODEL}`);
    const { result, elapsed } = await reviewDiff(diff);
    console.log(`[review-url] Completed in ${elapsed}ms — ${result.findings.length} findings`);
    return res.json({ ...result, elapsed_ms: elapsed });
  } catch (err) {
    console.error(`[review-url] Error after ${Date.now() - start}ms:`, err.message);
    const status = err.status || 500;
    return res.status(status).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;

// Only listen when run directly (not when imported by Vercel)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`PR Reviewer running at http://localhost:${PORT}`);
  });
}

module.exports = app;
