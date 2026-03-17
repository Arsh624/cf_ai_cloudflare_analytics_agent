# cf-ai-sql-agent

Built as part of the Cloudflare AI application assignment.

AI-powered analytics agent built on Cloudflare Workers, Workers AI, and D1 that converts natural language into SQL and executes queries across multiple databases.

Supports:
- Cloudflare D1 (default)
- PostgreSQL (Neon serverless)
- ClickHouse

---

## 🚀 Live Demo

https://cf-ai-sql-agent.arsh9532.workers.dev/

---

## 🧠 What this project is

This is not just a SQL generator.

It is an AI analytics agent that:
- understands a natural language question
- discovers the database schema dynamically
- generates a safe SQL query
- explains the reasoning
- executes the query
- returns results with optional visualization

The goal is to remove the need for dashboards or SQL knowledge.

---

## 💡 Why this matters (Cloudflare context)

Many teams depend on data but cannot write SQL:

- Sales → "How many users signed up today?"
- Support → "Top failing endpoints in last 24 hours"
- Security → "Number of DDoS events by region"

This system allows those questions to be asked directly.

This could be integrated into:
- internal chat tools (Slack / Google Chat bots)
- Cloudflare dashboards
- operational analytics tools

Instead of:
open dashboard → write query → debug

You get:
ask → get answer

---

## 🏗️ Architecture

User → UI → Cloudflare Worker → Workers AI → SQL generation → validation → optional approval → database execution → response → UI

Flow:

1. User submits a natural language question  
2. Worker discovers schema dynamically from selected database  
3. Workers AI generates SQL  
4. Worker enforces guardrails:
   - SELECT only
   - single statement
   - LIMIT 100 enforced  
5. AI generates reasoning + explanation  
6. Optional approval step  
7. Query executes on selected database  
8. Results + query plan returned  

---

## ⚙️ Cloudflare Components Used

- Cloudflare Workers
- Workers AI (Llama 3)
- Cloudflare D1
- Static assets via Workers
- Wrangler

---

## 🧩 Features

- Natural language → SQL
- Multi-database support (D1, Postgres, ClickHouse)
- Schema auto-discovery (no hardcoding)
- SQL safety guardrails
- Query plan inspection
- AI reasoning + explanation
- Optional approval mode
- Automatic charts
- Voice input (SpeechRecognition API)
- Query history (localStorage)

---

## 🗄️ External Database Support

Defaults to D1 if no database is provided.

### Postgres

```json
{
  "question": "Daily signups this week",
  "database": {
    "type": "postgres",
    "connection_string": "postgres://user:password@host:5432/dbname"
  }
}
```

### ClickHouse

```json
{
  "question": "Top users by activity",
  "database": {
    "type": "clickhouse",
    "connection_string": "http://localhost:8123"
  }
}
```

---

## 🔐 Safety

* Only allows SELECT queries
* Blocks destructive queries
* Enforces single statement
* Adds LIMIT automatically

---

## 🎤 Voice Input

* Uses browser SpeechRecognition API
* Converts speech → query
* Graceful fallback if unsupported

---

## 💾 Memory / State

* Query history stored in browser (localStorage)
* Allows replaying past queries

---

## 🧪 Local Development

Create D1 database:

```
npx wrangler d1 create analytics_db
```

Apply schema:

```
npx wrangler d1 execute analytics_db --local --file schema.sql
```

Run locally:

```
npm run dev
```

Open:

[http://127.0.0.1:8787](http://127.0.0.1:8787)

---

## 🚀 Deploy

```
npm run deploy
```

---

## ⚠️ Notes

External DB connection strings are passed from the browser for demo purposes.

In production, these should be stored securely using Workers secrets or managed connectors.

---

## 🧠 AI Usage

AI was used to:

* speed up UI and boilerplate work
* explore new libraries (ClickHouse, Neon)
* refine prompt design

All core architecture, validation logic, and system design decisions were implemented manually.

See PROMPTS.md for examples.

---

## 📌 Future Improvements

* Adapter-based database abstraction
* Persistent memory (Durable Objects)
* Chat-style multi-turn queries
* Slack / Google Chat integration
* Query caching

---

## 🧠 Summary

This project demonstrates:

* building with Cloudflare-native tools
* designing safe AI systems (guardrails + validation)
* multi-database analytics workflows
* fast iteration using AI as a development tool
