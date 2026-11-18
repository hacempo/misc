const { randomUUID } = require('crypto');

class Aria2Client {
    constructor(options = {}) {
        this.url = options.url || process.env.ARIA2_RPC_URL || 'http://127.0.0.1:29000/jsonrpc';
        this.token = options.token || process.env.TOKEN;
        this.timeout = options.timeout || 30000;
    }

    async call(method, params = []) {
        if (!this.token) throw new Error('缺少 TOKEN 环境变量（aria2 RPC 密钥）。');

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeout);
        try {
            const response = await fetch(this.url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0', id: randomUUID(), method,
                    params: ['token:' + this.token, ...params]
                }),
                signal: controller.signal
            });
            const text = await response.text();
            if (!response.ok) throw new Error('aria2 HTTP ' + response.status + ': ' + text);

            let data;
            try {
                data = JSON.parse(text);
            } catch {
                throw new Error('aria2 返回了无效 JSON：' + text);
            }
            if (data.error) throw new Error('aria2 error ' + data.error.code + ': ' + data.error.message);
            if (!Object.prototype.hasOwnProperty.call(data, 'result')) {
                throw new Error('aria2 RPC 响应缺少 result 字段。');
            }
            return data.result;
        } catch (error) {
            if (error.name === 'AbortError') throw new Error('aria2 RPC 请求超时（' + this.timeout + 'ms）。');
            throw error;
        } finally {
            clearTimeout(timer);
        }
    }

    addUri(url, dir, options = {}) {
        return this.call('aria2.addUri', [[url], { dir, ...options }]);
    }

    test() {
        return this.call('aria2.getVersion');
    }

    async getTaskCounts() {
        const active = await this.call('aria2.tellActive', [['gid']]);
        let waiting = 0;
        for (let offset = 0; ; ) {
            const page = await this.call('aria2.tellWaiting', [offset, 1000, ['gid']]);
            waiting += page.length;
            if (page.length < 1000) break;
            offset += page.length;
        }
        return { active: active.length, waiting, total: active.length + waiting };
    }

    async getTasksByGids(gids) {
        const wanted = new Set(gids);
        const found = new Map();
        const fields = ['gid', 'status', 'errorCode', 'errorMessage'];

        const active = await this.call('aria2.tellActive', [fields]);
        for (const task of active) if (wanted.has(task.gid)) found.set(task.gid, task);

        for (let offset = 0; found.size < wanted.size; ) {
            const page = await this.call('aria2.tellWaiting', [offset, 1000, fields]);
            for (const task of page) if (wanted.has(task.gid)) found.set(task.gid, task);
            if (page.length < 1000) break;
            offset += page.length;
        }

        for (let offset = 0; found.size < wanted.size; ) {
            const page = await this.call('aria2.tellStopped', [offset, 1000, fields]);
            for (const task of page) if (wanted.has(task.gid)) found.set(task.gid, task);
            if (page.length < 1000) break;
            offset += page.length;
        }

        return found;
    }
}

module.exports = Aria2Client;
