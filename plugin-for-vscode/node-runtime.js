const { spawn } = require('child_process');

const REQUIRED_NODE_MAJOR = 18;

function parseNodeMajor(version) {
    const match = /^v(\d+)\./.exec(String(version || '').trim());
    return match ? Number(match[1]) : 0;
}

function createNodeRuntimeCandidates({
    execPath = process.execPath,
    env = process.env,
} = {}) {
    const candidates = [];
    if (env.AI_FREE_NODE_PATH) {
        candidates.push({
            command: env.AI_FREE_NODE_PATH,
            envPatch: {},
            label: 'AI_FREE_NODE_PATH',
        });
    }
    if (execPath) {
        candidates.push({
            command: execPath,
            envPatch: { ELECTRON_RUN_AS_NODE: '1' },
            label: 'VS Code runtime',
        });
    }
    candidates.push({ command: 'node', envPatch: {}, label: 'Node.js from PATH' });
    return candidates.filter((candidate, index, all) =>
        all.findIndex((item) =>
            item.command === candidate.command
            && item.envPatch.ELECTRON_RUN_AS_NODE === candidate.envPatch.ELECTRON_RUN_AS_NODE
        ) === index
    );
}

function probeNodeRuntime(candidate, {
    timeoutMs = 5000,
    spawnImpl = spawn,
    env = process.env,
} = {}) {
    return new Promise((resolve) => {
        let child;
        try {
            child = spawnImpl(candidate.command, ['--version'], {
                env: { ...env, ...candidate.envPatch },
                windowsHide: true,
            });
        } catch (error) {
            resolve({ ok: false, message: error.message || String(error) });
            return;
        }

        let stdout = '';
        let stderr = '';
        let settled = false;
        const finish = (result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(result);
        };
        const timer = setTimeout(() => {
            try { child.kill(); } catch {}
            finish({ ok: false, message: `timed out after ${timeoutMs}ms` });
        }, timeoutMs);

        child.stdout?.on('data', (data) => { stdout += data.toString(); });
        child.stderr?.on('data', (data) => { stderr += data.toString(); });
        child.on('error', (error) => finish({
            ok: false,
            message: error.code === 'ENOENT' ? 'not found' : (error.message || String(error)),
        }));
        child.on('close', (code) => {
            if (code !== 0) {
                finish({ ok: false, message: `exited with code ${code}: ${stderr.trim()}` });
                return;
            }
            const version = stdout.trim();
            const major = parseNodeMajor(version);
            if (major < REQUIRED_NODE_MAJOR) {
                finish({ ok: false, message: `requires Node.js ${REQUIRED_NODE_MAJOR}+, found ${version || 'unknown'}` });
                return;
            }
            finish({ ok: true, version });
        });
    });
}

async function resolveNodeRuntime(options = {}) {
    const attempts = [];
    for (const candidate of createNodeRuntimeCandidates(options)) {
        const result = await probeNodeRuntime(candidate, options);
        if (result.ok) return { ...candidate, version: result.version, attempts };
        attempts.push(`${candidate.label}: ${result.message}`);
    }
    return { ok: false, attempts };
}

module.exports = {
    REQUIRED_NODE_MAJOR,
    createNodeRuntimeCandidates,
    parseNodeMajor,
    probeNodeRuntime,
    resolveNodeRuntime,
};
