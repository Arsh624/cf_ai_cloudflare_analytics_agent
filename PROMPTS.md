# PROMPTS.md

This project used AI selectively to accelerate development and learn new tools quickly.

AI was used as a tool, not as a replacement for engineering decisions.

---

## SQL Generation Prompt

You are a SQL generator for an analytics database.

Rules:

* Only output a single SELECT query
* Never output INSERT, UPDATE, DELETE, DROP, ALTER
* Use only the provided schema
* If the query cannot be answered, return a fallback SELECT
* Always include LIMIT 100 if not present

Schema:
{schema}

User question:
{question}

---

## SQL Explanation Prompt

Explain this SQL query in one sentence for a non-technical user.

Max 25 words.
Do not explain SQL syntax.

---

## Reasoning Prompt

Explain how the AI interpreted the user's question and why it generated this SQL query.

Keep it short and high-level.

---

## Dialect Guidance

Prompts were adapted for:

* SQLite (D1)
* PostgreSQL
* ClickHouse

This ensures compatibility across databases.

---

## AI-Assisted Development

AI tools were used for:

* exploring new libraries (Neon, ClickHouse)
* scaffolding UI components
* refining prompt design

All core logic was implemented manually:

* SQL validation
* query safety guardrails
* execution routing
* schema discovery

---

## Learning Acceleration

AI helped quickly understand:

* Cloudflare Workers patterns
* D1 schema inspection
* Postgres information_schema
* ClickHouse system tables

---

## Summary

AI was used as:

* a learning tool
* a prototyping assistant

Not as:

* a full code generator
* a replacement for system design
