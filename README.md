# PR Code Reviewer

A production-ready PR code review tool powered by the **OpenAI Responses API** with the **gpt-5.1-codex-mini** model (configurable). Paste a diff or enter a GitHub PR URL, and get structured, severity-tagged findings with actionable suggestions.

## Why the Responses API?

This project uses OpenAI's [Responses API](https://platform.openai.com/docs/api-reference/responses) instead of Chat Completions because:

- **Structured output enforcement** — the `json_schema` format guarantees the response matches the exact schema every time, with no parsing guesswork
- **Stateful tool support** — Responses API sessions can natively call tools like the code interpreter, web search, and file search across turns
- **Simpler request model** — single `input` string with `instructions`, rather than managing a messages array

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Create your .env file
cp .env.example .env
# Edit .env and add your OpenAI API key (and optional model override)

# 3. Start the server
node server.js
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

By default, the server uses `gpt-5.1-codex-mini`. You can override it with:

```bash
OPENAI_MODEL=your-model-id
```

## Usage

**Paste a diff** — copy the output of `git diff` or any unified diff format and paste it into the left panel.

**Use a GitHub PR URL** — enter a URL like `https://github.com/owner/repo/pull/123` and the server fetches the `.diff` automatically. Works with public repositories.

> **Tip:** You can get a raw diff from any GitHub PR by appending `.diff` to the URL:
> `https://github.com/owner/repo/pull/123.diff`

Click **Load Sample Diff** to try a pre-loaded example with intentional security issues (SQL injection, credential logging, etc.).

## Deploy to Vercel

```bash
# 1. Install the Vercel CLI
npm i -g vercel

# 2. Deploy
vercel

# 3. Set your API key
vercel env add OPENAI_API_KEY
```

The included `vercel.json` handles routing — API requests go to the Express server, everything else serves the static frontend.

## API

### POST /api/review

```json
{ "diff": "diff --git a/file.js ..." }
```

### POST /api/review-url

```json
{ "url": "https://github.com/owner/repo/pull/123" }
```

Both return:

```json
{
  "summary": "...",
  "recommendation": "approve | approve_with_changes | request_changes",
  "findings": [
    {
      "severity": "critical | high | medium | low | info",
      "category": "security | logic | performance | style | documentation",
      "file": "auth/login.js",
      "line_reference": "L15-L17",
      "finding": "SQL injection via string interpolation...",
      "suggestion": "Use parameterized queries..."
    }
  ],
  "elapsed_ms": 2340
}
```
