import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const dataDir = await mkdtemp(join(tmpdir(), 'mingzhongdu-feedback-'));
const port = 32000 + Math.floor(Math.random() * 1000);
const token = 'test-token-only-for-local-feedback-check';
const serverPath = resolve('server/feedback-service/server.mjs');
const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, FEEDBACK_ADMIN_TOKEN: token },
    stdio: ['ignore', 'pipe', 'pipe'],
});

const base = `http://127.0.0.1:${port}`;
async function waitForServer() {
    for (let attempt = 0; attempt < 40; attempt += 1) {
        try {
            const response = await fetch(`${base}/health`);
            if (response.ok) return;
        } catch {}
        await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    throw new Error('feedback service did not start');
}

const payload = {
    version: 2,
    gameVersion: '0.2.2',
    platform: 'web',
    submission: {
        version: 2,
        surveyVersion: '2.3',
        responseId: 'response-backend-test-0001',
        sessionId: 'session-backend-test-0001',
        submittedDate: '2026-09-03',
        answers: {
            priorKnowledge: 2,
            deepestImpression: 'knowledge-cards',
            improvementPriorities: ['history-depth', 'performance'],
            postKnowledge: 4,
            furtherLearningInterest: 5,
            overallSatisfaction: 4,
            suggestions: '继续优化移动端加载。',
        },
    },
};

try {
    await waitForServer();
    const created = await fetch(`${base}/feedback`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    });
    assert.equal(created.status, 201);
    const duplicate = await fetch(`${base}/feedback`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    });
    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json()).duplicate, true);

    const invalidPayload = structuredClone(payload);
    invalidPayload.submission.responseId = 'response-backend-test-0002';
    invalidPayload.submission.answers.improvementPriorities = ['none', 'performance'];
    const invalid = await fetch(`${base}/feedback`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(invalidPayload),
    });
    assert.equal(invalid.status, 400);

    const summary = await fetch(`${base}/feedback/summary`, {
        headers: { authorization: `Bearer ${token}` },
    });
    assert.deepEqual(await summary.json(), {
        total: 1, byPlatform: { web: 1 }, bySurveyVersion: { '2.3': 1 },
    });
    const csv = await fetch(`${base}/feedback/export.csv`, {
        headers: { authorization: `Bearer ${token}` },
    });
    const csvText = await csv.text();
    assert.match(csvText, /印象最深的部分/);
    assert.match(csvText, /knowledge-cards/);
    console.log('PASS feedback service accepts, deduplicates and exports questionnaire v2.3');
} finally {
    child.kill();
    await new Promise((resolveExit) => child.once('exit', resolveExit));
    await rm(dataDir, { recursive: true, force: true });
}
