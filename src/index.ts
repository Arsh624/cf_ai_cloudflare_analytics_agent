import { createClient } from '@clickhouse/client';
import { Pool } from '@neondatabase/serverless';

const MODEL = '@cf/meta/llama-3-8b-instruct';

interface Env {
	AI: Ai;
	ASSETS: Fetcher;
	DB: D1Database;
}

type DatabaseKind = 'd1' | 'postgres' | 'clickhouse';

type AskSqlRequest = {
	question?: unknown;
	execute?: unknown;
	approved_sql?: unknown;
	database?: unknown;
};

type DatabaseRequest = {
	type?: unknown;
	connection_string?: unknown;
};

type DatabaseTarget = {
	type: DatabaseKind;
	connectionString: string | null;
};

type QueryExecutionResult = {
	result: unknown[];
	queryPlan: string[];
	meta: Record<string, unknown> | null;
};

type AiTextResponse = {
	response?: string;
	result?: {
		response?: string;
	};
};

type SqliteTableRow = {
	name: string;
	sql: string | null;
};

type PostgresSchemaRow = {
	table_name: string;
	column_name: string;
	data_type: string;
};

type ClickhouseSchemaRow = {
	table: string;
	name: string;
	type: string;
};

const CORS_HEADERS = {
	'access-control-allow-origin': '*',
	'access-control-allow-methods': 'POST, OPTIONS',
	'access-control-allow-headers': 'content-type',
};

const DIALECT_INSTRUCTIONS: Record<DatabaseKind, string> = {
	d1: `
Cloudflare D1 uses SQLite syntax.
- Use SQLite-compatible syntax only.
- Never use PostgreSQL, MySQL, or SQL Server syntax such as EXTRACT(...), DATE_TRUNC(...), ILIKE, INTERVAL, NOW(), or :: casts.
- For date filtering in SQLite, prefer date(...) and strftime(...).
`.trim(),
	postgres: `
This database uses PostgreSQL syntax.
- Use PostgreSQL-compatible syntax only.
- You may use CURRENT_DATE, DATE_TRUNC(...), EXTRACT(...), ILIKE, and standard PostgreSQL expressions when appropriate.
`.trim(),
	clickhouse: `
This database uses ClickHouse syntax.
- Use ClickHouse-compatible syntax only.
- Prefer ClickHouse date and time helpers such as today(), toDate(...), toStartOfDay(...), and dateDiff(...) when appropriate.
- Do not use PostgreSQL casts like :: or SQLite-only date functions.
`.trim(),
};

function json(data: unknown, init?: ResponseInit): Response {
	return Response.json(data, {
		headers: {
			'content-type': 'application/json; charset=utf-8',
			...CORS_HEADERS,
		},
		...init,
	});
}

function getSqlPrompt(dialect: DatabaseKind, schema: string): string {
	return `
You are a SQL generator for an analytics database.
Return exactly one SQL query and nothing else.

Rules:
- Only output SQL.
- Only output a single SELECT statement.
- Never output INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, PRAGMA, ATTACH, DETACH, REPLACE, or transaction statements.
- Use only the schema provided below.
- If the request cannot be answered with the schema, return: SELECT 'Unable to answer with provided schema' AS message;
- If the query does not already contain a LIMIT clause, include LIMIT 100.

Dialect guidance:
${DIALECT_INSTRUCTIONS[dialect]}

Schema:
${schema}
`.trim();
}

function parseColumnsFromCreateTable(sql: string | null): Array<{ name: string; type: string }> {
	if (!sql) {
		return [];
	}

	const start = sql.indexOf('(');
	const end = sql.lastIndexOf(')');
	if (start === -1 || end === -1 || end <= start) {
		return [];
	}

	const definition = sql.slice(start + 1, end);
	const parts = definition
		.split(',')
		.map((part) => part.trim())
		.filter(Boolean);

	const columns: Array<{ name: string; type: string }> = [];

	for (const part of parts) {
		if (/^(primary|foreign|unique|check|constraint)\b/i.test(part)) {
			continue;
		}

		const match = part.match(/^["`[]?([A-Za-z0-9_]+)["`\]]?\s+([A-Za-z0-9_]+)/);
		if (!match) {
			continue;
		}

		columns.push({
			name: match[1],
			type: match[2],
		});
	}

	return columns;
}

async function discoverD1Schema(db: D1Database): Promise<string> {
	const tablesResult = await db
		.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
		.all<SqliteTableRow>();

	const tables = tablesResult.results ?? [];
	if (tables.length === 0) {
		return 'No application tables were found in the database.';
	}

	const schemaSections: string[] = [];
	for (const table of tables) {
		const columns = parseColumnsFromCreateTable(table.sql);
		const columnLines = columns.map((column) => `- ${column.name} ${column.type || 'TEXT'}`);
		schemaSections.push(`Table ${table.name}\n${columnLines.join('\n') || '- schema unavailable'}`);
	}

	return schemaSections.join('\n\n');
}

async function withPostgresPool<T>(connectionString: string, fn: (pool: Pool) => Promise<T>): Promise<T> {
	const pool = new Pool({ connectionString });

	try {
		return await fn(pool);
	} finally {
		await pool.end();
	}
}

async function discoverPostgresSchema(connectionString: string): Promise<string> {
	return withPostgresPool(connectionString, async (pool) => {
		const client = await pool.connect();

		try {
			const result = await client.query<PostgresSchemaRow>(`
				SELECT table_name, column_name, data_type
				FROM information_schema.columns
				WHERE table_schema='public'
				ORDER BY table_name, ordinal_position
			`);

			const tables = new Map<string, string[]>();
			for (const row of result.rows) {
				const lines = tables.get(row.table_name) ?? [];
				lines.push(`- ${row.column_name} ${row.data_type}`);
				tables.set(row.table_name, lines);
			}

			return Array.from(tables.entries())
				.map(([table, lines]) => `Table ${table}\n${lines.join('\n')}`)
				.join('\n\n');
		} finally {
			client.release();
		}
	});
}

async function executePostgresQuery(connectionString: string, sql: string): Promise<unknown[]> {
	return withPostgresPool(connectionString, async (pool) => {
		const client = await pool.connect();

		try {
			const result = await client.query(sql);
			return result.rows;
		} finally {
			client.release();
		}
	});
}

async function getPostgresQueryPlan(connectionString: string, sql: string): Promise<string[]> {
	try {
		const rows = await executePostgresQuery(connectionString, `EXPLAIN ${sql}`);
		return rows.map((row) => String(Object.values(row as Record<string, unknown>)[0] ?? JSON.stringify(row)));
	} catch {
		return [];
	}
}

async function withClickhouseClient<T>(
	connectionString: string,
	fn: (client: ReturnType<typeof createClient>) => Promise<T>,
): Promise<T> {
	const client = createClient({ url: connectionString });

	try {
		return await fn(client);
	} finally {
		await client.close();
	}
}

async function discoverClickhouseSchema(connectionString: string): Promise<string> {
	return withClickhouseClient(connectionString, async (client) => {
		const result = await client.query({
			query: `
				SELECT table, name, type
				FROM system.columns
				WHERE database = currentDatabase()
				ORDER BY table, position
			`,
			format: 'JSONEachRow',
		});

		const rows = (await result.json()) as ClickhouseSchemaRow[];
		const tables = new Map<string, string[]>();

		for (const row of rows) {
			const lines = tables.get(row.table) ?? [];
			lines.push(`- ${row.name} ${row.type}`);
			tables.set(row.table, lines);
		}

		return Array.from(tables.entries())
			.map(([table, lines]) => `Table ${table}\n${lines.join('\n')}`)
			.join('\n\n');
	});
}

async function executeClickhouseQuery(connectionString: string, sql: string): Promise<unknown[]> {
	return withClickhouseClient(connectionString, async (client) => {
		const result = await client.query({
			query: sql,
			format: 'JSONEachRow',
		});

		return (await result.json()) as unknown[];
	});
}

async function getClickhouseQueryPlan(connectionString: string, sql: string): Promise<string[]> {
	try {
		return withClickhouseClient(connectionString, async (client) => {
			const result = await client.query({
				query: `EXPLAIN ${sql}`,
				format: 'JSONEachRow',
			});

			const rows = (await result.json()) as Array<Record<string, unknown>>;
			return rows.map((row) => String(Object.values(row)[0] ?? JSON.stringify(row)));
		});
	} catch {
		return [];
	}
}

function buildSqlPrompt(question: string, schema: string, dialect: DatabaseKind): string {
	return `${getSqlPrompt(dialect, schema)}

User question:
${question}`;
}

function extractAiText(output: unknown): string {
	if (typeof output === 'string') {
		return output.trim();
	}

	if (output && typeof output === 'object') {
		const maybeResponse = output as AiTextResponse;
		const text = maybeResponse.response ?? maybeResponse.result?.response;
		if (typeof text === 'string') {
			return text.trim();
		}
	}

	return '';
}

function normalizeSql(raw: string): string {
	return raw
		.replace(/^```sql\s*/i, '')
		.replace(/^```\s*/i, '')
		.replace(/\s*```$/i, '')
		.trim();
}

function extractSqlCandidate(raw: string): string {
	const normalized = normalizeSql(raw);
	const match = normalized.match(/select[\s\S]*?(?:;|$)/i);
	return match ? match[0].trim().replace(/;+\s*$/, '') : normalized;
}

function appendLimitIfMissing(sql: string): string {
	return /\blimit\b/i.test(sql) ? sql.trim() : `${sql.trim()} LIMIT 100`;
}

function sanitizeSingleSentence(text: string, maxWords = 25): string {
	const cleaned = text
		.replace(/^here'?s the explanation:\s*/i, '')
		.replace(/^explanation:\s*/i, '')
		.replace(/^reasoning:\s*/i, '')
		.replace(/\s+/g, ' ')
		.trim();

	const firstSentenceMatch = cleaned.match(/.*?[.!?](?=\s|$)/);
	const firstSentence = (firstSentenceMatch ? firstSentenceMatch[0] : cleaned).trim();
	const words = firstSentence.split(/\s+/).filter(Boolean).slice(0, maxWords);
	let shortened = words.join(' ').replace(/[,:;]+$/g, '').trim();

	if (!shortened) {
		return '';
	}

	if (!/[.!?]$/.test(shortened)) {
		shortened += '.';
	}

	return shortened;
}

function hasUnsupportedSqliteSyntax(sql: string): boolean {
	return /\bextract\s*\(|\bdate_trunc\s*\(|\bilike\b|\binterval\b|\bnow\s*\(\s*\)|::/i.test(sql);
}

async function repairSqlForD1(env: Env, question: string, sql: string, schema: string): Promise<string> {
	const repairPrompt = `
You are fixing a SQL query so it runs on Cloudflare D1, which uses SQLite syntax.
Return exactly one corrected SQL query and nothing else.

Rules:
- Keep it a single SELECT statement.
- Use SQLite syntax only.
- Never use EXTRACT(...), DATE_TRUNC(...), ILIKE, INTERVAL, NOW(), or :: casts.
- Prefer date(...) and strftime(...) for date logic.
- Preserve the intent of the original question.
- If LIMIT is missing, include LIMIT 100.

Schema:
${schema}

User question:
${question}

SQL to repair:
${sql}
`.trim();

	const repairedOutput = await env.AI.run(MODEL, {
		prompt: repairPrompt,
	});

	return extractSqlCandidate(extractAiText(repairedOutput));
}

async function generateExplanation(env: Env, question: string, sql: string): Promise<string> {
	const explanationPrompt = `
You are explaining a SQL query to a non-expert user.
Return exactly 1 sentence.
Max 25 words.
Do not explain SQL syntax.

User question:
${question}

SQL query:
${sql}
`.trim();

	const explanationOutput = await env.AI.run(MODEL, {
		prompt: explanationPrompt,
	});

	return sanitizeSingleSentence(extractAiText(explanationOutput));
}

async function generateReasoning(env: Env, question: string, sql: string): Promise<string> {
	const reasoningPrompt = `
You are explaining how an AI translated a natural language question into SQL.

User question:
${question}

Generated SQL:
${sql}

Return exactly 1 sentence.
Max 25 words.
Do not explain SQL syntax.
Focus on how the question was interpreted and why this query answers it.
`.trim();

	const reasoningOutput = await env.AI.run(MODEL, {
		prompt: reasoningPrompt,
	});

	return sanitizeSingleSentence(extractAiText(reasoningOutput));
}

async function getD1QueryPlan(db: D1Database, sql: string): Promise<string[]> {
	try {
		const planQuery = `EXPLAIN QUERY PLAN ${sql}`;
		const result = await db.prepare(planQuery).all();
		const rows = result.results ?? [];

		return rows.map((row: Record<string, unknown>) => String(row.detail || JSON.stringify(row)));
	} catch {
		return [];
	}
}

function isSafeSelectQuery(sql: string): boolean {
	const normalized = sql.trim().replace(/;+\s*$/, '');

	if (!/^select\b/i.test(normalized)) {
		return false;
	}

	if (normalized.includes(';')) {
		return false;
	}

	const forbidden = /\b(insert|update|delete|drop|alter|create|pragma|attach|detach|replace|begin|commit|rollback)\b/i;
	return !forbidden.test(normalized);
}

function getQuestion(body: AskSqlRequest): string | null {
	if (typeof body.question !== 'string') {
		return null;
	}

	const question = body.question.trim();
	return question.length > 0 ? question : null;
}

function shouldExecute(body: AskSqlRequest): boolean {
	return body.execute !== false;
}

function getApprovedSql(body: AskSqlRequest): string | null {
	if (typeof body.approved_sql !== 'string') {
		return null;
	}

	const sql = body.approved_sql.trim();
	return sql.length > 0 ? sql : null;
}

function getDatabaseTarget(body: AskSqlRequest): DatabaseTarget | Response {
	if (!body.database) {
		return { type: 'd1', connectionString: null };
	}

	if (typeof body.database !== 'object') {
		return json({ error: 'The "database" field must be an object.' }, { status: 400 });
	}

	const database = body.database as DatabaseRequest;
	const type = typeof database.type === 'string' ? database.type.toLowerCase() : 'd1';

	if (type === 'd1') {
		return { type: 'd1', connectionString: null };
	}

	if (type !== 'postgres' && type !== 'clickhouse') {
		return json({ error: 'Unsupported database type. Use "d1", "postgres", or "clickhouse".' }, { status: 400 });
	}

	if (typeof database.connection_string !== 'string' || database.connection_string.trim() === '') {
		return json({ error: 'A connection string is required for external databases.' }, { status: 400 });
	}

	return {
		type,
		connectionString: database.connection_string.trim(),
	};
}

async function discoverSchemaForTarget(target: DatabaseTarget, env: Env): Promise<string> {
	switch (target.type) {
		case 'postgres':
			return discoverPostgresSchema(target.connectionString!);
		case 'clickhouse':
			return discoverClickhouseSchema(target.connectionString!);
		case 'd1':
		default:
			return discoverD1Schema(env.DB);
	}
}

async function executeQueryForTarget(target: DatabaseTarget, env: Env, sql: string): Promise<QueryExecutionResult> {
	const start = Date.now();

	switch (target.type) {
		case 'postgres': {
			const queryPlan = await getPostgresQueryPlan(target.connectionString!, sql);
			const result = await executePostgresQuery(target.connectionString!, sql);
			return {
				result,
				queryPlan,
				meta: {
					duration: Date.now() - start,
					database_type: 'postgres',
				},
			};
		}
		case 'clickhouse': {
			const queryPlan = await getClickhouseQueryPlan(target.connectionString!, sql);
			const result = await executeClickhouseQuery(target.connectionString!, sql);
			return {
				result,
				queryPlan,
				meta: {
					duration: Date.now() - start,
					database_type: 'clickhouse',
				},
			};
		}
		case 'd1':
		default: {
			const queryPlan = await getD1QueryPlan(env.DB, sql);
			const result = await env.DB.prepare(sql).all();
			return {
				result: result.results ?? [],
				queryPlan,
				meta: result.meta ?? { duration: Date.now() - start, database_type: 'd1' },
			};
		}
	}
}

export default {
	async fetch(request, env): Promise<Response> {
		if (request.method === 'OPTIONS') {
			return new Response(null, {
				status: 204,
				headers: CORS_HEADERS,
			});
		}

		if (request.method === 'GET') {
			return env.ASSETS.fetch(request);
		}

		if (request.method !== 'POST') {
			return json(
				{
					error: 'Method not allowed. Use POST with JSON: {"question":"..."}',
				},
				{ status: 405 },
			);
		}

		let body: AskSqlRequest;
		try {
			body = await request.json<AskSqlRequest>();
		} catch {
			return json({ error: 'Request body must be valid JSON.' }, { status: 400 });
		}

		const question = getQuestion(body);
		if (!question) {
			return json({ error: 'The "question" field must be a non-empty string.' }, { status: 400 });
		}

		const target = getDatabaseTarget(body);
		if (target instanceof Response) {
			return target;
		}

		const executeQuery = shouldExecute(body);
		const approvedSql = getApprovedSql(body);

		try {
			const schema = await discoverSchemaForTarget(target, env);

			let generatedSql = approvedSql ?? '';
			if (!generatedSql) {
				const aiOutput = await env.AI.run(MODEL, {
					prompt: buildSqlPrompt(question, schema, target.type),
				});
				const rawModelText = extractAiText(aiOutput);
				generatedSql = extractSqlCandidate(rawModelText);
			}

			generatedSql = appendLimitIfMissing(generatedSql);
			if (target.type === 'd1' && hasUnsupportedSqliteSyntax(generatedSql)) {
				generatedSql = appendLimitIfMissing(await repairSqlForD1(env, question, generatedSql, schema));
			}

			const explanation = isSafeSelectQuery(generatedSql)
				? await generateExplanation(env, question, generatedSql)
				: '';
			const reasoning = isSafeSelectQuery(generatedSql)
				? await generateReasoning(env, question, generatedSql)
				: '';

			if (!generatedSql || !explanation || !reasoning || !isSafeSelectQuery(generatedSql)) {
				return json(
					{
						question,
						generated_sql: generatedSql || null,
						reasoning: reasoning || null,
						explanation: explanation || null,
						query_plan: [],
						error: 'The model did not return a valid single SELECT query.',
					},
					{ status: 422 },
				);
			}

			if (!executeQuery) {
				return json({
					question,
					generated_sql: generatedSql,
					reasoning,
					explanation,
					query_plan: [],
					result: [],
					meta: {
						database_type: target.type,
					},
				});
			}

			const execution = await executeQueryForTarget(target, env, generatedSql);
			return json({
				question,
				generated_sql: generatedSql,
				reasoning,
				explanation,
				query_plan: execution.queryPlan,
				result: execution.result,
				meta: execution.meta,
			});
		} catch (error) {
			return json(
				{
					question,
					generated_sql: null,
					reasoning: null,
					explanation: null,
					query_plan: [],
					error: error instanceof Error ? error.message : 'Failed to process the query.',
				},
				{ status: 400 },
			);
		}
	},
} satisfies ExportedHandler<Env>;
