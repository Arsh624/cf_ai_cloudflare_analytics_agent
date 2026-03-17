const endpoint = '/';
const historyKey = 'cf-ai-sql-agent-history';
const maxHistoryItems = 8;
const suggestedQueries = [
	'How many users signed up today?',
	'Which users have never logged in?',
	'Daily signups this week',
	'Average logins per user',
];

const questionInput = document.querySelector('#question');
const sendButton = document.querySelector('#send');
const approveRunButton = document.querySelector('#approve-run');
const approvalModeCheckbox = document.querySelector('#approval-mode');
const databaseTypeSelect = document.querySelector('#database-type');
const connectionGroup = document.querySelector('#connection-group');
const connectionStringInput = document.querySelector('#connection-string');
const voiceButton = document.querySelector('#voice');
const spinner = document.querySelector('#spinner');
const statusText = document.querySelector('#status-text');
const executionTimeOutput = document.querySelector('#execution-time');
const sqlOutput = document.querySelector('#sql');
const reasoningOutput = document.querySelector('#reasoning');
const explanationOutput = document.querySelector('#explanation');
const queryPlanOutput = document.querySelector('#query-plan');
const resultsContainer = document.querySelector('#results');
const historyContainer = document.querySelector('#history');
const historyEmpty = document.querySelector('#history-empty');
const suggestionsContainer = document.querySelector('#suggestions');
const chartCanvas = document.querySelector('#result-chart');
const chartEmpty = document.querySelector('#chart-empty');
const copySqlButton = document.querySelector('#copy-sql');
const dbBadge = document.querySelector('#db-badge');
const resultChartHeader = document.querySelector('.result-card:last-child h2');

const SpeechRecognitionApi = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isListening = false;
let pendingTranscript = '';
let lastQuestion = '';
let lastGeneratedSql = '';
let currentChart = null;

function setStatus(message, loading = false) {
	statusText.textContent = message;
	spinner.classList.toggle('visible', loading);
}

function setExecutionTime(meta) {
	const duration = meta?.duration;
	if (typeof duration === 'number') {
		executionTimeOutput.textContent = `Execution time: ${duration} ms`;
		return;
	}

	executionTimeOutput.textContent = 'Execution time: waiting for query';
}

function getDatabasePayload() {
	const type = databaseTypeSelect.value;
	if (type === 'd1') {
		return undefined;
	}

	const connectionString = connectionStringInput.value.trim();
	if (!connectionString) {
		throw new Error('Connection string is required for external databases.');
	}

	return {
		type,
		connection_string: connectionString,
	};
}

function syncDatabaseFields() {
	const isExternal = databaseTypeSelect.value !== 'd1';
	connectionGroup.hidden = !isExternal;
	connectionStringInput.required = isExternal;
	connectionStringInput.placeholder =
		databaseTypeSelect.value === 'clickhouse'
			? 'http://localhost:8123'
			: 'postgres://user:password@host:5432/dbname';
	updateDatabaseBadge();
}

function updateDatabaseBadge() {
	const type = databaseTypeSelect.value;
	const label = type === 'd1' ? 'D1' : type === 'postgres' ? 'Postgres' : 'ClickHouse';
	dbBadge.textContent = `Database: ${label}`;
}

function escapeHtml(value) {
	return String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

function highlightSql(sql) {
	return escapeHtml(sql)
		.replace(
			/\b(SELECT|FROM|WHERE|JOIN|LEFT JOIN|RIGHT JOIN|INNER JOIN|GROUP BY|ORDER BY|LIMIT|HAVING|AS|ON|AND|OR|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TABLE|INTO|VALUES|SET|INDEX|DATABASE|GRANT|REVOKE|BEGIN|COMMIT|ROLLBACK|UNION|ALL|DISTINCT)\b/gi,
			'<span class="keyword">$1</span>',
		)
		.replace(/\b(COUNT|SUM|AVG|MIN|MAX|DATE|STRFTIME|ROUND|COALESCE|EXPLAIN|IFNULL|NULLIF|LENGTH|LOWER|UPPER|TRIM)\b/gi, '<span class="function">$1</span>')
		.replace(/'([^']*)'/g, "<span class=\"string\">'$1'</span>");
}

function renderSql(sql) {
	sqlOutput.innerHTML = sql ? highlightSql(sql) : 'Waiting for a question...';
}

function renderQueryPlan(lines) {
	if (Array.isArray(lines) && lines.length > 0) {
		queryPlanOutput.textContent = lines.join('\n');
		return;
	}

	queryPlanOutput.textContent = 'No query plan available.';
}

function destroyChart() {
	if (currentChart) {
		currentChart.destroy();
		currentChart = null;
	}

	chartCanvas.hidden = true;
	chartEmpty.hidden = false;
}

function renderTable(rows) {
	if (!Array.isArray(rows) || rows.length === 0) {
		resultsContainer.className = 'empty';
		resultsContainer.innerHTML = 'Query ran successfully, but no rows were returned.';
		return;
	}

	const columns = Object.keys(rows[0]);
	const head = columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('');
	const body = rows
		.map((row) => {
			const cells = columns.map((column) => `<td>${escapeHtml(row[column] ?? '')}</td>`).join('');
			return `<tr>${cells}</tr>`;
		})
		.join('');

	resultsContainer.className = 'table-wrap';
	resultsContainer.innerHTML = `
		<table>
			<thead><tr>${head}</tr></thead>
			<tbody>${body}</tbody>
		</table>
	`;
}

function looksNumeric(value) {
	if (typeof value === 'number') {
		return true;
	}

	if (typeof value === 'string' && value.trim() !== '') {
		return !Number.isNaN(Number(value));
	}

	return false;
}

function looksCategorical(value) {
	return typeof value === 'string';
}

function renderChart(rows) {
	destroyChart();

	if (!window.Chart || !Array.isArray(rows) || rows.length === 0) {
		return;
	}

	const columns = Object.keys(rows[0]);
	if (columns.length !== 2) {
		return;
	}

	const [labelColumn, valueColumn] = columns;
	const labels = rows.map((row) => row[labelColumn]);
	const values = rows.map((row) => row[valueColumn]);

	if (!labels.every(looksCategorical) || !values.every(looksNumeric)) {
		return;
	}

	chartCanvas.hidden = false;
	chartEmpty.hidden = true;

	currentChart = new window.Chart(chartCanvas, {
		type: 'bar',
		data: {
			labels: labels.map((label) => String(label)),
			datasets: [
				{
					label: valueColumn,
					data: values.map((value) => Number(value)),
					backgroundColor: 'rgba(15, 118, 110, 0.72)',
					borderColor: 'rgba(15, 118, 110, 1)',
					borderWidth: 2,
					borderRadius: 10,
				},
			],
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			scales: {
				y: {
					beginAtZero: true,
				},
			},
			plugins: {
				legend: {
					display: false,
				},
				title: {
					display: true,
					text: `Data for: "${lastQuestion}"`,
					font: {
						family: 'Plus Jakarta Sans',
						size: 16,
						weight: '800'
					},
					color: '#000',
					padding: 20
				}
			},
		},
	});
}

function getFriendlyError(response, data) {
	if (data?.error) {
		return data.error;
	}

	if (response.status === 400) {
		return 'The Worker could not run that SQL query.';
	}

	if (response.status === 422) {
		return 'The model returned an unsafe or invalid SQL response. Try rephrasing the question.';
	}

	if (response.status >= 500) {
		return 'The Worker hit an internal error. Please try again in a moment.';
	}

	return `Request failed with status ${response.status}.`;
}

function loadHistory() {
	try {
		const raw = localStorage.getItem(historyKey);
		const parsed = raw ? JSON.parse(raw) : [];
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function saveHistory(entry) {
	const history = loadHistory()
		.filter((item) => item.question !== entry.question)
		.slice(0, maxHistoryItems - 1);

	history.unshift(entry);
	localStorage.setItem(historyKey, JSON.stringify(history));
	renderHistory();
}

function setApprovalButtonVisible(visible) {
	approveRunButton.hidden = !visible;
}

function rerunHistory(question) {
	questionInput.value = question;
	runQuery();
}

function renderHistory() {
	const history = loadHistory();
	historyContainer.innerHTML = '';
	historyEmpty.style.display = history.length === 0 ? 'block' : 'none';

	for (const item of history) {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'history-item';
		button.innerHTML = `
			<strong>${escapeHtml(item.question)}</strong>
			<small>${escapeHtml(item.generated_sql || 'No SQL captured')}</small>
		`;
		button.addEventListener('click', () => rerunHistory(item.question));
		historyContainer.appendChild(button);
	}
}

function renderSuggestions() {
	suggestionsContainer.innerHTML = '';

	for (const suggestion of suggestedQueries) {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'suggestion-chip';
		button.textContent = suggestion;
		button.addEventListener('click', () => {
			const targetValue = suggestion;
			questionInput.value = '';
			let i = 0;
			const typeWriter = () => {
				if (i < targetValue.length) {
					questionInput.value += targetValue.charAt(i);
					i++;
					setTimeout(typeWriter, 20);
				} else {
					questionInput.focus();
					setStatus('Suggestion loaded. Press Run Query or use voice input.', false);
				}
			};
			typeWriter();
		});
		suggestionsContainer.appendChild(button);
	}
}

function applyVoiceTranscript(transcript) {
	const cleanedTranscript = transcript.trim();
	if (!cleanedTranscript) {
		return;
	}

	questionInput.value = cleanedTranscript;
	setStatus('Voice captured. Running query...', true);
	runQuery();
}

function createRecognition() {
	if (!SpeechRecognitionApi) {
		voiceButton.disabled = true;
		voiceButton.title = 'Speech recognition is not supported in this browser.';
		return null;
	}

	const instance = new SpeechRecognitionApi();
	instance.lang = 'en-US';
	instance.interimResults = false;
	instance.continuous = false;
	instance.maxAlternatives = 1;

	instance.addEventListener('start', () => {
		isListening = true;
		pendingTranscript = '';
		voiceButton.classList.add('listening');
		setStatus('Listening for your question...', true);
	});

	instance.addEventListener('result', (event) => {
		const transcriptParts = [];
		for (const result of event.results) {
			const spokenText = result?.[0]?.transcript;
			if (spokenText) {
				transcriptParts.push(spokenText);
			}
		}

		pendingTranscript = transcriptParts.join(' ').trim();
		if (pendingTranscript) {
			questionInput.value = pendingTranscript;
			setStatus('Voice captured. Finishing recognition...', true);
		}
	});

	instance.addEventListener('error', (event) => {
		pendingTranscript = '';
		const message =
			event.error === 'not-allowed'
				? 'Microphone access was blocked. Allow microphone permission and try again.'
				: `Voice input failed: ${event.error}.`;
		setStatus(message, false);
	});

	instance.addEventListener('speechend', () => {
		if (isListening) {
			instance.stop();
		}
	});

	instance.addEventListener('end', () => {
		isListening = false;
		voiceButton.classList.remove('listening');
		if (pendingTranscript) {
			const transcriptToUse = pendingTranscript;
			pendingTranscript = '';
			applyVoiceTranscript(transcriptToUse);
			return;
		}

		if (!spinner.classList.contains('visible')) {
			setStatus('Voice input ready.', false);
		}
	});

	return instance;
}

function buildRequestBody(executeImmediately, approvedSql = null) {
	const body = {
		question: approvedSql ? lastQuestion : questionInput.value.trim(),
		execute: executeImmediately,
	};

	const database = getDatabasePayload();
	if (database) {
		body.database = database;
	}

	if (approvedSql) {
		body.approved_sql = approvedSql;
	}

	return body;
}

async function handleResponse(response) {
	const data = await response.json();
	lastGeneratedSql = data.generated_sql ?? lastGeneratedSql;
	renderSql(lastGeneratedSql);
	reasoningOutput.textContent = data.reasoning || 'No reasoning returned.';
	explanationOutput.textContent = data.explanation ?? 'No explanation returned.';
	renderQueryPlan(data.query_plan);
	setExecutionTime(data.meta);
	return data;
}

async function runQuery() {
	const question = questionInput.value.trim();
	if (!question) {
		setStatus('Enter a question before sending.', false);
		questionInput.focus();
		return;
	}

	try {
		getDatabasePayload();
	} catch (error) {
		setStatus(error instanceof Error ? error.message : 'Database configuration is invalid.', false);
		return;
	}

	const executeImmediately = !approvalModeCheckbox.checked;
	lastQuestion = question;
	sendButton.disabled = true;
	approveRunButton.disabled = true;
	voiceButton.disabled = true;
	setApprovalButtonVisible(false);
	setStatus('Generating SQL with Workers AI...', true);
	setExecutionTime(null);
	renderSql('SELECT ...');
	reasoningOutput.textContent = 'Tracing how the model is turning your question into SQL...';
	explanationOutput.textContent = 'Interpreting your question and preparing a query...';
	renderQueryPlan([]);
	resultsContainer.className = 'empty';
	resultsContainer.textContent = 'Running query...';
	destroyChart();

	try {
		const response = await fetch(endpoint, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
			},
			body: JSON.stringify(buildRequestBody(executeImmediately)),
		});

		const data = await handleResponse(response);

		if (!response.ok) {
			resultsContainer.className = 'error';
			resultsContainer.textContent = getFriendlyError(response, data);
			setStatus(`Request failed with status ${response.status}.`, false);
			return;
		}

		if (!executeImmediately) {
			resultsContainer.className = 'empty';
			resultsContainer.textContent = 'SQL generated. Review it, then click Run SQL to execute.';
			setApprovalButtonVisible(true);
			approveRunButton.disabled = false;
			setStatus('Approval required before execution.', false);
			return;
		}

		renderTable(data.result);
		renderChart(data.result);
		saveHistory({
			question,
			generated_sql: lastGeneratedSql,
			explanation: data.explanation ?? '',
			timestamp: Date.now(),
		});
		setStatus('Done.', false);
	} catch (error) {
		renderSql('');
		reasoningOutput.textContent = 'The request did not complete.';
		explanationOutput.textContent = 'The request did not complete.';
		renderQueryPlan([]);
		resultsContainer.className = 'error';
		resultsContainer.textContent =
			error instanceof Error
				? `Could not reach the Worker endpoint: ${error.message}`
				: 'Could not reach the Worker endpoint.';
		setStatus('Could not reach the Worker endpoint.', false);
	} finally {
		sendButton.disabled = false;
		approveRunButton.disabled = false;
		voiceButton.disabled = !SpeechRecognitionApi;
		spinner.classList.remove('visible');
	}
}

async function runApprovedSql() {
	if (!lastQuestion || !lastGeneratedSql) {
		setStatus('Generate SQL first before approving execution.', false);
		return;
	}

	try {
		getDatabasePayload();
	} catch (error) {
		setStatus(error instanceof Error ? error.message : 'Database configuration is invalid.', false);
		return;
	}

	sendButton.disabled = true;
	approveRunButton.disabled = true;
	voiceButton.disabled = true;
	setStatus('Executing approved SQL...', true);
	resultsContainer.className = 'empty';
	resultsContainer.textContent = 'Running the approved query...';
	destroyChart();

	try {
		const response = await fetch(endpoint, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
			},
			body: JSON.stringify(buildRequestBody(true, lastGeneratedSql)),
		});

		const data = await handleResponse(response);

		if (!response.ok) {
			resultsContainer.className = 'error';
			resultsContainer.textContent = getFriendlyError(response, data);
			setStatus(`Request failed with status ${response.status}.`, false);
			return;
		}

		renderTable(data.result);
		renderChart(data.result);
		saveHistory({
			question: lastQuestion,
			generated_sql: lastGeneratedSql,
			explanation: data.explanation ?? '',
			timestamp: Date.now(),
		});
		setApprovalButtonVisible(false);
		setStatus('Approved SQL executed.', false);
	} catch (error) {
		resultsContainer.className = 'error';
		resultsContainer.textContent =
			error instanceof Error
				? `Could not execute the approved SQL: ${error.message}`
				: 'Could not execute the approved SQL.';
		setStatus('Could not execute the approved SQL.', false);
	} finally {
		sendButton.disabled = false;
		approveRunButton.disabled = false;
		voiceButton.disabled = !SpeechRecognitionApi;
		spinner.classList.remove('visible');
	}
}

async function copyToClipboard(text) {
	try {
		await navigator.clipboard.writeText(text);
		const originalText = copySqlButton.textContent;
		copySqlButton.textContent = 'Copied!';
		copySqlButton.classList.add('success');
		setTimeout(() => {
			copySqlButton.textContent = originalText;
			copySqlButton.classList.remove('success');
		}, 1500);
	} catch (error) {
		console.error('Copy failed', error);
	}
}

copySqlButton.addEventListener('click', () => {
	copyToClipboard(lastGeneratedSql || sqlOutput.textContent);
});

databaseTypeSelect.addEventListener('change', syncDatabaseFields);
sendButton.addEventListener('click', runQuery);
approveRunButton.addEventListener('click', runApprovedSql);
voiceButton.addEventListener('click', () => {
	if (!recognition) {
		setStatus('Speech recognition is not supported in this browser.', false);
		return;
	}

	if (isListening) {
		recognition.stop();
		return;
	}

	recognition.start();
});

questionInput.addEventListener('keydown', (event) => {
	if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
		runQuery();
	}
});

recognition = createRecognition();
syncDatabaseFields();
renderHistory();
renderSuggestions();
renderSql('');
renderQueryPlan([]);
setExecutionTime(null);
destroyChart();
