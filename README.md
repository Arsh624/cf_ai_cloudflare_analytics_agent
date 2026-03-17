# cf-ai-sql-agent

An AI-powered Cloudflare Worker that accepts a natural-language analytics question, generates a SQL `SELECT` query with Workers AI, explains the query in plain English, executes it against Cloudflare D1 by default, and can optionally route queries to Postgres or ClickHouse.

## System Architecture

The application is built around a single Cloudflare Worker that handles both the frontend and backend:

1. A browser loads the UI from the Worker with `GET /`.
2. The user types a question or uses voice input powered by the browser `SpeechRecognition` API.
3. The UI sends the question to `POST /`.
4. The Worker discovers the live schema dynamically from the selected database.
5. Workers AI returns a `SELECT` query.
6. The Worker validates that the SQL is a single safe `SELECT`.
7. The Worker appends `LIMIT 100` when the query does not include one.
8. The Worker asks Workers AI for short reasoning and explanation text.
9. The Worker optionally waits for user approval before execution.
10. The Worker runs the query against D1, Postgres, or ClickHouse and returns:
   `question`, `generated_sql`, `reasoning`, `explanation`, `query_plan`, and `result`.

## Cloudflare Components Used

- Cloudflare Workers
- Workers AI
- Cloudflare D1
- Static Assets via Worker asset binding
- Wrangler for local development and deployment
- Optional external database clients via `@neondatabase/serverless` and `@clickhouse/client`

## Agent Design

The SQL agent is intentionally narrow:

- The prompt includes the live schema so the model stays grounded in the available tables and columns.
- The schema is discovered dynamically from the database instead of being hardcoded.
- The Worker rejects any output that is not a single `SELECT` statement.
- After the SQL is validated, short AI passes explain what the query does and why the model chose it.
- If the SQL does not include a `LIMIT`, the Worker appends `LIMIT 100`.
- Only after validation does the Worker execute the SQL against the selected backend.

This keeps the working SQL generation pipeline intact while adding a human-readable explanation layer for the UI.

## Voice Input

The frontend includes a microphone button that uses the browser `SpeechRecognition` API when available.

- Click the microphone button.
- Speak your analytics question.
- The transcript is inserted into the input box.
- The query runs through the normal `POST /` pipeline.

If the browser does not support speech recognition, the app disables the microphone button gracefully.

## UI Features

- Suggested example prompts on first load
- Database selector for D1, Postgres, and ClickHouse
- Optional approval mode before executing SQL
- Automatic charts for simple two-column analytics results
- Query history saved in the browser
- Voice input for natural-language questions
- Query plan inspection and execution timing

## Stack

- TypeScript
- Browser SpeechRecognition API

## Local Development

1. Create the D1 database:

```bash
npx wrangler d1 create analytics_db
```

2. Copy the returned `database_id` into [wrangler.jsonc](/c:/Users/archi/cf-ai-sql-agent/wrangler.jsonc).

3. Apply the schema locally:

```bash
npx wrangler d1 execute analytics_db --local --file schema.sql
```

4. Start the Worker:

```bash
npm run dev
```

5. Open the app:

```text
http://127.0.0.1:8787
```

## Deploy

1. Apply the schema to the remote D1 database:

```bash
npx wrangler d1 execute analytics_db --remote --file schema.sql
```

2. Deploy the Worker:

```bash
npm run deploy
```

## API Example

```bash
curl -X POST http://localhost:8787 \
  -H "content-type: application/json" \
  -d "{\"question\":\"How many users signed up today?\"}"
```

Example response:

```json
{
  "question": "How many users signed up today?",
  "generated_sql": "SELECT COUNT(*) FROM users WHERE DATE(signup_date) = DATE('now')",
  "reasoning": "The AI interpreted the prompt as a request for today's signup count.",
  "explanation": "This query counts how many users signed up today.",
  "query_plan": ["SCAN users USING COVERING INDEX idx_signup_date"],
  "result": [
    {
      "COUNT(*)": 2
    }
  ]
}
```

## External Database Support

The Worker still defaults to Cloudflare D1 when no database object is provided.

Postgres example:

```json
{
  "question": "Daily signups this week",
  "database": {
    "type": "postgres",
    "connection_string": "postgres://user:password@host:5432/dbname"
  }
}
```

ClickHouse example:

```json
{
  "question": "Top users by activity",
  "database": {
    "type": "clickhouse",
    "connection_string": "http://localhost:8123"
  }
}
```

If you select `D1` in the UI, the connection string field is hidden and the Worker uses the existing local or deployed D1 binding.

Note: passing external connection strings from the browser is appropriate for a demo or assignment, but production deployments should move credentials to secure server-side secrets or managed connectors.
