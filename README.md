# cf-ai-sql-agent

Database-agnostic AI analytics agent on Cloudflare Workers that lets anyone query real data using natural language instead of SQL. Built on Cloudflare Workers, Workers AI, and D1 that allows anyone to query production data using natural language.

Instead of writing SQL or navigating dashboards, users can simply ask:
> "How many users signed up today?"
> "Top DDoS events in the last 24 hours"
> "Which endpoints are failing the most?"

…and get answers instantly.

---

## 🚀 Live Demo

https://cf-ai-sql-agent.arsh9532.workers.dev/

---

## 🧠 What this actually is

This is not just a "natural language → SQL" tool.

It is an **AI data interface layer** designed to sit on top of real systems.

It:
- understands natural language questions
- dynamically reads database schema (no hardcoding)
- generates safe SQL queries using Workers AI
- explains what it's doing
- optionally asks for approval
- executes queries across multiple databases
- returns results + query plan + visualization

---

## 💡 Why this matters (use case)

Inside a company like Cloudflare, a lot of people need data but don't write SQL:

- Support engineers checking request failures
- Security teams analyzing attack patterns
- Sales teams pulling usage metrics
- Product teams exploring user behavior

Right now, the flow usually looks like:
> open dashboard → find the right dataset → write query → debug → repeat

This project changes that to:
> ask a question → get an answer immediately

---

## 🔌 Where this fits inside Cloudflare

This can plug directly into:

- **Cloudflare dashboard** → natural language analytics panel
- **Internal tools** → query logs, traffic, security events
- **Chat integrations (Slack / Google Chat)** → ask data questions inline
- **Developer platform** → query D1 / R2 / analytics without writing SQL

Example:

> "@analytics-bot how many DDoS attacks in the last 24 hours?"

No dashboards. No SQL. Just answers.

---

## 💡 Key Idea

Turn data access from:
> "you need to know the system"

into:
> "the system understands you"

---

## 🏗️ Architecture

User → UI → Cloudflare Worker → Workers AI → SQL generation → validation → optional approval → database execution → response → UI

---

## 🔐 Safety-first design

AI is constrained, not trusted blindly:

- Only allows SELECT queries
- Blocks all destructive operations
- Enforces single statement
- Automatically adds LIMIT
- Schema-grounded prompts (no hallucinated tables)
- Optional approval before execution

---

## 🗄️ Multi-Database Support

The system is database-agnostic:

- Cloudflare D1 (default)
- PostgreSQL (Neon serverless)
- ClickHouse (columnar analytics)

This allows the same interface to work across different storage systems.

---

## 🔍 Why this is interesting (engineering POV)

This project explores:

- safe AI systems (guardrails + validation layers)
- schema-aware prompting
- multi-database abstraction
- edge execution with Workers
- real-time analytics workflows

---

## ⚙️ Cloudflare Components Used

- Cloudflare Workers (execution layer)
- Workers AI (LLM inference)
- Cloudflare D1 (default database)
- Static asset serving via Workers
- Wrangler (local + deploy)

---

## 🧩 UX Features

- natural language input
- voice input (SpeechRecognition API)
- approval mode for safety
- query explanation + reasoning
- automatic chart generation
- query history (localStorage)

---

## 🏆 What makes this different

Most NL → SQL tools:
- assume fixed schema
- break on real data
- are unsafe to execute

This system:
- dynamically reads schema
- enforces strict safety rules
- works across databases
- is designed for real usage, not just demos

---

## 📡 Example API Usage

```json
{
  "question": "Daily signups this week",
  "database": {
    "type": "postgres",
    "connection_string": "postgres://user:password@host:5432/dbname"
  }
}
```

---

## ⚠️ Notes

External database connection strings are passed from the browser for demo purposes.

In production, these should be handled securely via Workers secrets or managed connectors.

---

## 🧠 AI Usage

AI was used to:

* accelerate UI and boilerplate
* explore new libraries (Neon, ClickHouse)
* refine prompt design

All core system design, validation logic, and architecture were implemented manually.

See PROMPTS.md for details.

---

## 📌 Future Improvements

* adapter pattern for database abstraction
* persistent memory (Durable Objects)
* chat-style multi-turn queries
* Slack / Google Chat bot integration
* query caching layer

---

## 🧠 Summary

This project demonstrates:

* building production-style systems on Cloudflare
* designing safe AI pipelines (not just calling an LLM)
* making data access simpler for non-technical users
* using AI as a tool to ship faster, not replace thinking
