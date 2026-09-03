import { createServer } from 'node:http';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';

const port = Number(process.env.PORT || 3102);
const host = process.env.HOST || '127.0.0.1';
const dataDir = process.env.DATA_DIR || './data';
const allowedOrigins = new Set(
    String(process.env.ALLOWED_ORIGINS || process.env.ALLOWED_ORIGIN || 'https://nyasd.net')
        .split(',').map((item) => item.trim()).filter(Boolean),
);
const adminToken = String(process.env.FEEDBACK_ADMIN_TOKEN || '');
const dataFile = join(dataDir, 'feedback.ndjson');
const maxBodyBytes = 64 * 1024;

const consentOptions = new Set(['adult-consent', 'minor-guardian-consent']);
const participationOptions = new Set(['self', 'mixed', 'demo']);
const moduleOptions = new Set([
    'start-map', 'location-scenes', 'tour-route', 'knowledge-cards',
    'magnifier', 'fragments-puzzle', 'settings',
]);
const ageOptions = new Set(['under-18', '18-25', '26-40', '41-60', '61-plus', 'prefer-not']);
const improvementOptions = new Set([
    'history-clarity', 'history-depth', 'map-spatial-relations', 'tour-guidance',
    'movement-touch', 'scene-navigation', 'magnifier-fragments',
    'visual-readability', 'performance', 'none', 'other',
]);

await mkdir(dataDir, { recursive: true });

function setCors(response, origin) {
    if (origin && allowedOrigins.has(origin)) {
        response.setHeader('access-control-allow-origin', origin);
        response.setHeader('vary', 'origin');
    }
}

function writeJson(response, statusCode, body, origin = '') {
    response.statusCode = statusCode;
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.setHeader('cache-control', 'no-store');
    setCors(response, origin);
    response.end(JSON.stringify(body));
}

function isRecord(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isRating(value) {
    return Number.isInteger(value) && value >= 1 && value <= 5;
}

function isAgreement(value) {
    return value === 'na' || isRating(value);
}

function validOptionArray(value, options, minimum = 0, maximum = Number.POSITIVE_INFINITY) {
    return Array.isArray(value)
        && value.length >= minimum
        && value.length <= maximum
        && value.every((item) => typeof item === 'string' && options.has(item));
}

function validateSubmission(value) {
    if (!isRecord(value) || value.version !== 1) return false;
    if (typeof value.gameVersion !== 'string' || value.gameVersion.length > 32) return false;
    if (!['web', 'wechatgame'].includes(value.platform)) return false;
    const submission = value.submission;
    if (!isRecord(submission)
        || submission.version !== 1
        || submission.surveyVersion !== '1.1'
        || typeof submission.responseId !== 'string'
        || !/^response-[a-z0-9-]{8,80}$/i.test(submission.responseId)
        || typeof submission.sessionId !== 'string'
        || submission.sessionId.length > 120
        || typeof submission.submittedDate !== 'string'
        || !/^\d{4}-\d{2}-\d{2}$/.test(submission.submittedDate)) return false;
    const answers = submission.answers;
    if (!isRecord(answers)) return false;
    if (!consentOptions.has(answers.consent) || !participationOptions.has(answers.participationMode)) return false;
    if (!validOptionArray(answers.experiencedModules, moduleOptions, 1, moduleOptions.size)) return false;
    if (answers.ageGroup !== undefined && !ageOptions.has(answers.ageGroup)) return false;
    if (!isRating(answers.priorKnowledge)) return false;
    if (answers.experiencedModules.includes('knowledge-cards') && !isAgreement(answers.knowledgeCardClarity)) return false;
    if (![answers.spatialRelationshipUnderstanding, answers.historicalMeaningUnderstanding,
        answers.furtherLearningInterest, answers.digitalDisplaySuitability,
        answers.visualThemeCoherence].every(isAgreement)) return false;
    if (!isRating(answers.overallSatisfaction) || !isRating(answers.recommendationWillingness)) return false;
    if (!validOptionArray(answers.improvementPriorities, improvementOptions, 1, 3)) return false;
    if (answers.improvementOther !== undefined
        && (typeof answers.improvementOther !== 'string' || answers.improvementOther.length > 120)) return false;
    if (answers.memorableContent !== undefined
        && (typeof answers.memorableContent !== 'string' || answers.memorableContent.length > 300)) return false;
    return true;
}

async function readJsonBody(request) {
    const chunks = [];
    let received = 0;
    for await (const chunk of request) {
        received += chunk.length;
        if (received > maxBodyBytes) throw new Error('BODY_TOO_LARGE');
        chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function readRecords() {
    let raw = '';
    try {
        raw = await readFile(dataFile, 'utf8');
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }
    return raw.split(/\r?\n/).filter(Boolean).flatMap((line) => {
        try { return [JSON.parse(line)]; } catch { return []; }
    });
}

const knownResponseIds = new Set(
    (await readRecords()).map((item) => item?.responseId).filter((item) => typeof item === 'string'),
);

function bearerToken(request) {
    const header = String(request.headers.authorization || '');
    return header.startsWith('Bearer ') ? header.slice(7) : '';
}

function safeTokenEqual(candidate) {
    if (!adminToken || !candidate) return false;
    const expected = Buffer.from(adminToken);
    const actual = Buffer.from(candidate);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function requireAdmin(request, response, origin) {
    if (safeTokenEqual(bearerToken(request))) return true;
    response.setHeader('www-authenticate', 'Bearer realm="MingZhongdu Survey Export"');
    writeJson(response, 401, { ok: false, error: 'unauthorized' }, origin);
    return false;
}

function csvCell(value) {
    const text = value === undefined || value === null ? '' : String(value);
    return `"${text.replaceAll('"', '""')}"`;
}

const exportColumns = [
    ['接收时间', (r) => r.receivedAt],
    ['答卷编号', (r) => r.responseId],
    ['来源平台', (r) => r.platform],
    ['游戏版本', (r) => r.gameVersion],
    ['问卷版本', (r) => r.surveyVersion],
    ['提交日期', (r) => r.submittedDate],
    ['同意类型', (r) => r.answers?.consent],
    ['体验方式', (r) => r.answers?.participationMode],
    ['体验模块', (r) => r.answers?.experiencedModules?.join(';')],
    ['年龄段', (r) => r.answers?.ageGroup],
    ['体验前了解程度', (r) => r.answers?.priorKnowledge],
    ['知识卡清晰度', (r) => r.answers?.knowledgeCardClarity],
    ['空间关系理解', (r) => r.answers?.spatialRelationshipUnderstanding],
    ['历史意义理解', (r) => r.answers?.historicalMeaningUnderstanding],
    ['继续了解兴趣', (r) => r.answers?.furtherLearningInterest],
    ['数字展示适合度', (r) => r.answers?.digitalDisplaySuitability],
    ['视觉主题协调度', (r) => r.answers?.visualThemeCoherence],
    ['总体满意度', (r) => r.answers?.overallSatisfaction],
    ['推荐意愿', (r) => r.answers?.recommendationWillingness],
    ['优先改进项', (r) => r.answers?.improvementPriorities?.join(';')],
    ['其他改进意见', (r) => r.answers?.improvementOther],
    ['印象最深内容', (r) => r.answers?.memorableContent],
];

function makeCsv(records) {
    const rows = [exportColumns.map(([title]) => csvCell(title)).join(',')];
    records.filter((record) => isRecord(record.answers)).forEach((record) => {
        rows.push(exportColumns.map(([, getter]) => csvCell(getter(record))).join(','));
    });
    return `\uFEFF${rows.join('\r\n')}\r\n`;
}

function adminPage() {
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>明中都问卷后台</title><style>body{font-family:system-ui,"Microsoft YaHei",sans-serif;max-width:720px;margin:48px auto;padding:0 20px;color:#2d2419;background:#f7f1e4}main{background:#fffaf0;border:1px solid #d7b56a;border-radius:14px;padding:28px}input{box-sizing:border-box;width:100%;padding:12px;border:1px solid #b79a62;border-radius:8px;margin:8px 0 16px}button{padding:11px 18px;margin:0 8px 8px 0;border:0;border-radius:8px;background:#743225;color:#fff;cursor:pointer}#status{min-height:24px;color:#6a5131}</style></head><body><main><h1>明中都体验问卷后台</h1><p>输入管理员导出令牌后，可随时下载 Excel 可直接打开的 UTF-8 CSV，或下载原始 JSON 备份。</p><label>管理员令牌<input id="token" type="password" autocomplete="current-password"></label><button data-file="export.csv">导出 CSV</button><button data-file="export.json">导出 JSON</button><button id="summary">查看数量</button><p id="status"></p></main><script>const t=document.querySelector('#token'),s=document.querySelector('#status');t.value=sessionStorage.getItem('mz-token')||'';async function api(path){sessionStorage.setItem('mz-token',t.value);const r=await fetch(path,{headers:{Authorization:'Bearer '+t.value}});if(!r.ok)throw new Error(r.status===401?'令牌不正确':'请求失败 '+r.status);return r}document.querySelectorAll('[data-file]').forEach(b=>b.onclick=async()=>{try{s.textContent='正在生成…';const r=await api(b.dataset.file),blob=await r.blob(),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=(r.headers.get('content-disposition')||'').match(/filename="([^"]+)/)?.[1]||b.dataset.file;a.click();URL.revokeObjectURL(a.href);s.textContent='导出完成。'}catch(e){s.textContent=e.message}});document.querySelector('#summary').onclick=async()=>{try{const r=await api('summary'),j=await r.json();s.textContent='当前共 '+j.total+' 份；网页 '+(j.byPlatform.web||0)+' 份；微信小游戏 '+(j.byPlatform.wechatgame||0)+' 份。'}catch(e){s.textContent=e.message}}</script></body></html>`;
}

const server = createServer(async (request, response) => {
    const origin = String(request.headers.origin || '');
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (origin && !allowedOrigins.has(origin)) {
        writeJson(response, 403, { ok: false, error: 'origin_not_allowed' });
        return;
    }
    if (request.method === 'OPTIONS' && url.pathname.startsWith('/feedback')) {
        response.statusCode = 204;
        setCors(response, origin);
        response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
        response.setHeader('access-control-allow-headers', 'content-type, authorization');
        response.setHeader('access-control-max-age', '86400');
        response.end();
        return;
    }
    if (request.method === 'GET' && url.pathname === '/health') {
        writeJson(response, 200, { ok: true, exportEnabled: Boolean(adminToken) }, origin);
        return;
    }
    if (request.method === 'GET' && url.pathname === '/feedback/admin') {
        response.statusCode = 200;
        response.setHeader('content-type', 'text/html; charset=utf-8');
        response.setHeader('cache-control', 'no-store');
        response.setHeader('content-security-policy', "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'");
        response.end(adminPage());
        return;
    }
    if (request.method === 'POST' && url.pathname === '/feedback') {
        try {
            const payload = await readJsonBody(request);
            if (!validateSubmission(payload)) {
                writeJson(response, 400, { ok: false, error: 'invalid_submission' }, origin);
                return;
            }
            const submission = payload.submission;
            if (knownResponseIds.has(submission.responseId)) {
                writeJson(response, 200, { ok: true, duplicate: true, responseId: submission.responseId }, origin);
                return;
            }
            const record = {
                id: randomUUID(), receivedAt: new Date().toISOString(),
                responseId: submission.responseId, sessionId: submission.sessionId,
                submittedDate: submission.submittedDate, surveyVersion: submission.surveyVersion,
                gameVersion: payload.gameVersion, platform: payload.platform, answers: submission.answers,
            };
            await appendFile(dataFile, `${JSON.stringify(record)}\n`, 'utf8');
            knownResponseIds.add(record.responseId);
            writeJson(response, 201, { ok: true, id: record.id, responseId: record.responseId }, origin);
        } catch (error) {
            const tooLarge = error instanceof Error && error.message === 'BODY_TOO_LARGE';
            writeJson(response, tooLarge ? 413 : 400, { ok: false, error: tooLarge ? 'body_too_large' : 'invalid_json' }, origin);
        }
        return;
    }
    if (request.method === 'GET' && url.pathname.startsWith('/feedback/')) {
        if (!requireAdmin(request, response, origin)) return;
        const records = await readRecords();
        if (url.pathname === '/feedback/export.csv') {
            const date = new Date().toISOString().slice(0, 10);
            response.statusCode = 200;
            response.setHeader('content-type', 'text/csv; charset=utf-8');
            response.setHeader('content-disposition', `attachment; filename="mingzhongdu-survey-${date}.csv"`);
            response.setHeader('cache-control', 'no-store');
            response.end(makeCsv(records));
            return;
        }
        if (url.pathname === '/feedback/export.json') {
            response.statusCode = 200;
            response.setHeader('content-type', 'application/json; charset=utf-8');
            response.setHeader('content-disposition', 'attachment; filename="mingzhongdu-survey.json"');
            response.setHeader('cache-control', 'no-store');
            response.end(JSON.stringify(records, null, 2));
            return;
        }
        if (url.pathname === '/feedback/summary') {
            const questionnaireRecords = records.filter((item) => isRecord(item.answers));
            const byPlatform = questionnaireRecords.reduce((result, item) => {
                result[item.platform] = (result[item.platform] || 0) + 1;
                return result;
            }, {});
            writeJson(response, 200, { total: questionnaireRecords.length, byPlatform }, origin);
            return;
        }
    }
    writeJson(response, 404, { ok: false, error: 'not_found' }, origin);
});

server.listen(port, host, () => {
    console.log(`[feedback-service] listening on http://${host}:${port}`);
    if (!adminToken) console.warn('[feedback-service] FEEDBACK_ADMIN_TOKEN is empty; exports are disabled.');
});
