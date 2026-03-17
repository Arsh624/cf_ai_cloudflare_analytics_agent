import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index';

// For now, you'll need to do something like this to get a correctly-typed
// `Request` to pass to `worker.fetch()`.
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

const env = {
	AI: {
		run: async () => ({
			response: 'SELECT COUNT(*) AS total FROM users',
		}),
	},
	DB: {
		prepare: (sql: string) => ({
			all: async () => ({
				results: [{ total: 3 }],
				meta: { sql },
			}),
		}),
	},
} as unknown as Env;

describe('AI SQL worker', () => {
	it('responds with generated SQL results', async () => {
		const request = new IncomingRequest('http://example.com', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
			},
			body: JSON.stringify({
				question: 'How many users signed up today?',
			}),
		});
		// Create an empty context to pass to `worker.fetch()`.
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		// Wait for all `Promise`s passed to `ctx.waitUntil()` to settle before running test assertions
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			question: 'How many users signed up today?',
			generated_sql: 'SELECT COUNT(*) AS total FROM users',
			result: [{ total: 3 }],
		});
	});

	it('rejects non-POST requests', async () => {
		const request = new IncomingRequest('http://example.com');
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(405);
	});
});
