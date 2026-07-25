'use strict';

const http = require('http');

const EXTENSION_NAME = 'ming-zhongdu-tools';
const OVERWORLD_URL = 'db://assets/scenes/Overworld.scene';
const LOCATION_TEMPLATE_URL = 'db://assets/scenes/LocationTemplate.scene';
const BRIDGE_HOST = '127.0.0.1';
const BRIDGE_PORT = 32123;

let bridgeServer = null;

function formatError(error) {
    if (error instanceof Error) {
        return error.stack || error.message;
    }
    return String(error);
}

async function findOverworld() {
    const assetInfo = await Editor.Message.request(
        'asset-db',
        'query-asset-info',
        OVERWORLD_URL,
    );

    if (!assetInfo || !assetInfo.uuid) {
        throw new Error(`未找到大地图场景：${OVERWORLD_URL}`);
    }

    return assetInfo;
}

async function openOverworldScene() {
    const assetInfo = await findOverworld();
    await Editor.Message.request('scene', 'open-scene', assetInfo.uuid);
    console.log(`[${EXTENSION_NAME}] 已打开大地图场景：${OVERWORLD_URL}`);
}

async function openLocationTemplateScene() {
    const assetInfo = await Editor.Message.request(
        'asset-db',
        'query-asset-info',
        LOCATION_TEMPLATE_URL,
    );
    if (!assetInfo || !assetInfo.uuid) {
        throw new Error(`未找到小地点模板：${LOCATION_TEMPLATE_URL}`);
    }
    await Editor.Message.request('scene', 'open-scene', assetInfo.uuid);
    console.log(`[${EXTENSION_NAME}] 已打开小地点模板：${LOCATION_TEMPLATE_URL}`);
}

function sendJson(response, statusCode, body) {
    response.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
    });
    response.end(JSON.stringify(body));
}

async function handleBridgeRequest(request, response) {
    const url = new URL(request.url || '/', `http://${BRIDGE_HOST}:${BRIDGE_PORT}`);

    if (request.method === 'GET' && url.pathname === '/health') {
        sendJson(response, 200, {
            ok: true,
            extension: EXTENSION_NAME,
            overworld: OVERWORLD_URL,
            revision: 'region-editor-v6-spawn-cleanup',
        });
        return;
    }

    if (request.method === 'POST' && url.pathname === '/open-overworld') {
        await openOverworldScene();
        sendJson(response, 200, { ok: true });
        return;
    }

    if (request.method === 'POST' && url.pathname === '/refresh-and-open-overworld') {
        await Editor.Message.request('asset-db', 'refresh-asset', 'db://assets');
        await openOverworldScene();
        sendJson(response, 200, { ok: true });
        return;
    }

    if (request.method === 'POST' && url.pathname === '/refresh-and-open-location-template') {
        await Editor.Message.request('asset-db', 'refresh-asset', 'db://assets');
        await openLocationTemplateScene();
        sendJson(response, 200, { ok: true });
        return;
    }

    if (request.method === 'POST' && url.pathname === '/open-region-editor') {
        await Editor.Panel.open(`${EXTENSION_NAME}.region-editor`);
        sendJson(response, 200, { ok: true });
        return;
    }

    if (request.method === 'GET' && url.pathname === '/scene-ids') {
        const sceneIds = await Editor.Message.request('scene', 'execute-scene-script', {
            name: EXTENSION_NAME,
            method: 'listSceneIds',
            args: [],
        });
        sendJson(response, 200, { ok: true, sceneIds });
        return;
    }

    if (request.method === 'POST' && url.pathname === '/build-named-transitions') {
        const result = await Editor.Message.request('scene', 'execute-scene-script', {
            name: EXTENSION_NAME,
            method: 'buildNamedTransitions',
            args: [],
        });
        await Editor.Message.request('asset-db', 'refresh-asset', 'db://assets/resources/locations');
        await Editor.Message.request('scene', 'save-scene');
        sendJson(response, 200, { ok: true, result });
        return;
    }

    sendJson(response, 404, { ok: false, error: 'unknown endpoint' });
}

function startBridge() {
    if (bridgeServer) {
        return;
    }

    bridgeServer = http.createServer((request, response) => {
        handleBridgeRequest(request, response).catch((error) => {
            console.error(`[${EXTENSION_NAME}] 本机桥接命令失败：${formatError(error)}`);
            sendJson(response, 500, { ok: false, error: String(error) });
        });
    });

    bridgeServer.on('error', (error) => {
        console.error(`[${EXTENSION_NAME}] 本机桥接启动失败：${formatError(error)}`);
    });

    bridgeServer.listen(BRIDGE_PORT, BRIDGE_HOST, () => {
        console.log(
            `[${EXTENSION_NAME}] 本机桥接已启动：http://${BRIDGE_HOST}:${BRIDGE_PORT}`,
        );
    });
}

exports.methods = {
    openRegionEditor() {
        Editor.Panel.open(`${EXTENSION_NAME}.region-editor`);
        return true;
    },
    async openOverworld() {
        try {
            await openOverworldScene();
            return true;
        } catch (error) {
            console.error(`[${EXTENSION_NAME}] 打开大地图失败：${formatError(error)}`);
            return false;
        }
    },

    async refreshAndOpenOverworld() {
        try {
            await Editor.Message.request('asset-db', 'refresh-asset', 'db://assets');
            await openOverworldScene();
            return true;
        } catch (error) {
            console.error(`[${EXTENSION_NAME}] 刷新或打开大地图失败：${formatError(error)}`);
            return false;
        }
    },

    async openLocationTemplate() {
        try {
            await Editor.Message.request('asset-db', 'refresh-asset', 'db://assets');
            await openLocationTemplateScene();
            return true;
        } catch (error) {
            console.error(`[${EXTENSION_NAME}] 打开小地点模板失败：${formatError(error)}`);
            return false;
        }
    },
};

exports.load = function load() {
    console.log(`[${EXTENSION_NAME}] 明中都工具扩展已加载`);
    startBridge();
};

exports.unload = function unload() {
    if (bridgeServer) {
        bridgeServer.close();
        bridgeServer = null;
    }
    console.log(`[${EXTENSION_NAME}] 明中都工具扩展已卸载`);
};
