import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { NodeService } from '../core/node_service.js';
import { JsonlFileRepository } from '../adapters/jsonl_repository.js';
import { JsonStateSnapshotExporter } from '../adapters/snapshot_exporter.js';
import { UdpPeerTransport } from '../adapters/udp_peer_discovery.js';
import { SystemBrowserLauncher } from '../adapters/browser_launcher.js';
import { SyncEngine } from '../domain/sync_engine.js';
import { StructuredTaskValidator } from '../domain/task_validator.js';
import { crypto } from '../core/crypto_util.js';
import { JsonConfigAdapter } from '../adapters/config.js';

const getFilename = () => {
  if (typeof __filename !== 'undefined') return __filename;
  try {
    return fileURLToPath(import.meta.url);
  } catch {
    return '';
  }
};
const currentFilename = getFilename();
const currentDirname = typeof __dirname !== 'undefined' ? __dirname : (currentFilename ? path.dirname(currentFilename) : process.cwd());

function getPublicDir(currentDir: string): string {
  const candidates = [
    path.join(process.cwd(), 'public'),
    path.join(currentDir, '../../public'),
    path.join(currentDir, '../public'),
    path.join(currentDir, 'public'),
    '/snapshot/share-log/public',
    '/snapshot/public',
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(path.join(candidate, 'index.html'))) {
        return candidate;
      }
    } catch {}
  }
  return path.join(process.cwd(), 'public');
}

const PUBLIC_DIR = getPublicDir(currentDirname);

async function main() {
  // Load Configuration via DI Adapter
  const configAdapter = new JsonConfigAdapter();
  const config = await configAdapter.loadConfig();

  // Resolve Data Directory
  const DATA_DIR = config.dataDir;

  const SNAPSHOT_FILE = path.join(DATA_DIR, 'state.json');
  const DATA_FILE = path.join(DATA_DIR, 'events.jsonl');

  const PORT = config.port;
  const NODE_ID = config.nodeName;
  const UDP_PORT = config.udpPort;

  // 1. Dependency Injection setup according to DEV_POLICY_v1.0518.md
  const repository = new JsonlFileRepository(DATA_FILE);
  const snapshotExporter = new JsonStateSnapshotExporter(SNAPSHOT_FILE);
  const transport = new UdpPeerTransport({ nodeId: NODE_ID, port: UDP_PORT });
  const browserLauncher = new SystemBrowserLauncher();
  const syncEngine = new SyncEngine();
  const validator = new StructuredTaskValidator();

  const nodeService = new NodeService({
    nodeId: NODE_ID,
    repository,
    transport,
    syncEngine,
    validator,
    snapshotExporter,
  });

  let activeProjectId = 'default-project';

  async function bootstrap() {
    await repository.init();
    await nodeService.start();

    const state = await nodeService.getProjectState(activeProjectId);
    const allEvents = await nodeService.getAllEvents();

    if (state.tasks.size === 0 && allEvents.length === 0) {
      // 1. Hydrate state from existing state.json snapshot if present
      const existingSnapshot = await snapshotExporter.loadSnapshot();
      if (existingSnapshot && Array.isArray(existingSnapshot.tasks) && existingSnapshot.tasks.length > 0) {
        console.log(`[Bootstrap] Hydrating ${existingSnapshot.tasks.length} tasks from existing state.json...`);
        const pId = existingSnapshot.projectId || activeProjectId;
        activeProjectId = pId;
        await nodeService.createProject(existingSnapshot.projectName || 'LAN Share-Log Project');

        for (const task of existingSnapshot.tasks) {
          await nodeService.createTask(pId, {
            title: task.title,
            parentId: task.parentId || undefined,
            status: task.status,
            priority: task.priority,
            dueDate: task.dueDate || null,
          });
        }
        console.log(`[Bootstrap] Successfully hydrated state.json snapshot.`);
        return;
      }

      // 2. If no events AND no snapshot exist, check if demo mode requested or initialize clean project
      if (process.env.CREATE_DEMO_TASKS === 'true') {
        console.log('[Bootstrap] Creating initial demo tasks...');
        await nodeService.createProject('LAN Share-Log Project');

        const root1 = await nodeService.createTask(activeProjectId, {
          title: '親タスク: LAN内P2Pローカルファースト開発',
          priority: 'HIGH',
          status: 'IN_PROGRESS',
        });
        const root1Id = root1.payload.taskId;

        const mid1 = await nodeService.createTask(activeProjectId, {
          parentId: root1Id,
          title: '中階層: ストレージ＆同期基盤の構築',
          status: 'IN_PROGRESS',
        });
        const mid1Id = mid1.payload.taskId;

        await nodeService.createTask(activeProjectId, {
          parentId: mid1Id,
          title: '子タスク: JSONLイベントログの永続化',
          status: 'DONE',
        });

        await nodeService.createTask(activeProjectId, {
          parentId: mid1Id,
          title: '子タスク: P2P差分同期エンジンの検証',
          status: 'IN_PROGRESS',
        });

        const mid2 = await nodeService.createTask(activeProjectId, {
          parentId: root1Id,
          title: '中階層: UI＆可視化レイヤーの開発',
          status: 'TODO',
        });
        const mid2Id = mid2.payload.taskId;

        await nodeService.createTask(activeProjectId, {
          parentId: mid2Id,
          title: '子タスク: Obsidianノードグラフバネ物理の実装',
          status: 'DONE',
        });

        await nodeService.createTask(activeProjectId, {
          parentId: mid2Id,
          title: '子タスク: 樹状ツリー＆カンバン表示の統合',
          status: 'IN_PROGRESS',
        });

        await nodeService.createTask(activeProjectId, {
          parentId: mid2Id,
          title: '子タスク: ログベース・ガントチャートプロット',
          status: 'TODO',
        });

        await nodeService.createTask(activeProjectId, {
          title: '独立ルートタスク: 全体ロードマップの策定',
          status: 'DONE',
        });

        const now = Date.now();
        const DAY_MS = 86400000;
        const allEvts = await nodeService.getAllEvents();
        const timeOffsets = [
          85 * DAY_MS, 80 * DAY_MS, 70 * DAY_MS, 65 * DAY_MS, 60 * DAY_MS,
          55 * DAY_MS, 50 * DAY_MS, 35 * DAY_MS, 30 * DAY_MS, 25 * DAY_MS,
          45 * DAY_MS, 40 * DAY_MS, 38 * DAY_MS, 20 * DAY_MS, 15 * DAY_MS,
          10 * DAY_MS, 5 * DAY_MS,
        ];

        allEvts.forEach((evt, idx) => {
          const offset = timeOffsets[idx % timeOffsets.length] || (90 - idx * 4) * DAY_MS;
          evt.timestamp = now - offset;

          if (evt.type === 'TASK_CREATED') {
            const dueOffsets = [15 * DAY_MS, 30 * DAY_MS, 45 * DAY_MS, 60 * DAY_MS, 75 * DAY_MS, 90 * DAY_MS];
            evt.payload.dueDate = now + dueOffsets[idx % dueOffsets.length];
          }
        });

        if (fs.existsSync(DATA_FILE)) {
          fs.writeFileSync(DATA_FILE, allEvts.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf-8');
        }
      } else {
        console.log('[Bootstrap] No existing events or snapshot found. Initializing clean project...');
        await nodeService.createProject('LAN Share-Log Project');
      }
    }

    console.log(`[NodeService] Started Node "${NODE_ID}" with JSONL storage at: ${DATA_FILE}`);
  }

  const server = http.createServer((req, res) => {
    const rawUrl = req.url || '/';
    const pathname = rawUrl.split('?')[0];
    const relativePath = pathname === '/' ? 'index.html' : (pathname.startsWith('/') ? pathname.slice(1) : pathname);
    const filePath = path.normalize(path.join(PUBLIC_DIR, relativePath));

    const normalizedPublic = path.normalize(PUBLIC_DIR);
    if (!filePath.startsWith(normalizedPublic)) {
      res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>403 Forbidden</h1>');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.woff2': 'font/woff2',
    };
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
      if (err) {
        if (err.code === 'ENOENT') {
          res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h1>404 Not Found</h1>');
        } else {
          res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<h1>500 Internal Server Error: ${err.code}</h1>`);
        }
      } else {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
      }
    });
  });

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[Share-Log Web UI Error] Port ${PORT} is already in use.`);
      console.error(`[Share-Log Web UI Error] Please terminate the process using port ${PORT} or specify PORT=<port>.`);
      process.exit(1);
    } else {
      console.error(`[Share-Log Web UI Error] Server error:`, err);
    }
  });

  const wss = new WebSocketServer({ server });
  const connectedClients = new Set<WebSocket>();

  wss.on('connection', async (ws) => {
    connectedClients.add(ws);

    const state = await nodeService.getProjectState(activeProjectId);
    const events = await nodeService.getAllEvents();
    ws.send(
      JSON.stringify({
        type: 'STATE_INIT',
        nodeId: NODE_ID,
        projectId: activeProjectId,
        dataFile: DATA_FILE,
        events,
        state: {
          project: state.project,
          tasks: Array.from(state.tasks.values()),
        },
      })
    );

    ws.on('message', async (rawMessage) => {
      try {
        const data = JSON.parse(rawMessage.toString());
        if (data.action === 'CREATE_TASK') {
          try {
            await nodeService.createTask(activeProjectId, {
              parentId: data.parentId || null,
              title: data.title,
              priority: data.priority,
              status: data.status || 'TODO',
              dueDate: data.dueDate || null,
            });
            await broadcastStateToUI();
          } catch (err: any) {
            ws.send(
              JSON.stringify({
                type: 'ERROR',
                message: err.message || 'タスク生成エラー',
              })
            );
          }
        } else if (data.action === 'UPDATE_STATUS') {
          try {
            await nodeService.updateTaskStatus(
              activeProjectId,
              data.taskId,
              data.status,
              data.newOrderIndex
            );
            await broadcastStateToUI();
          } catch (err: any) {
            ws.send(
              JSON.stringify({
                type: 'ERROR',
                message: err.message || 'ステータス更新エラー',
              })
            );
          }
        } else if (data.action === 'UPDATE_TITLE') {
          try {
            await nodeService.updateTaskTitle(activeProjectId, data.taskId, data.title);
            await broadcastStateToUI();
          } catch (err: any) {
            ws.send(
              JSON.stringify({
                type: 'ERROR',
                message: err.message || 'タイトル更新エラー',
              })
            );
          }
        } else if (data.action === 'UPDATE_DUE_DATE') {
          await nodeService.updateTaskDueDate(activeProjectId, data.taskId, data.dueDate || null);
          await broadcastStateToUI();
        } else if (data.action === 'REORDER_TASK') {
          await nodeService.reorderTask(activeProjectId, data.taskId, data.newOrderIndex);
          await broadcastStateToUI();
        } else if (data.action === 'CHANGE_PARENT') {
          await nodeService.changeTaskParent(activeProjectId, data.taskId, data.newParentId);
          await broadcastStateToUI();
        } else if (data.action === 'TOGGLE_COLLAPSE') {
          // Tree node collapse/expand is local client UI state and excluded from P2P broadcast
        } else if (data.action === 'DELETE_TASK') {
          try {
            await nodeService.deleteTask(activeProjectId, data.taskId, data.reason);
            await broadcastStateToUI();
          } catch (err: any) {
            ws.send(
              JSON.stringify({
                type: 'ERROR',
                message: err.message || 'タスク削除エラー',
              })
            );
          }
        } else if (data.action === 'UNDO_LAST_ACTION') {
          try {
            await nodeService.undoLastAction(activeProjectId);
            await broadcastStateToUI();
          } catch (err: any) {
            ws.send(
              JSON.stringify({
                type: 'ERROR',
                message: err.message || 'Undoエラー',
              })
            );
          }
        }
      } catch (e) {
        console.error('[WS Message Error]', e);
      }
    });

    ws.on('close', () => {
      connectedClients.delete(ws);
    });
  });

  async function broadcastStateToUI() {
    const state = await nodeService.getProjectState(activeProjectId);
    const events = await nodeService.getAllEvents();
    const payload = JSON.stringify({
      type: 'STATE_UPDATE',
      nodeId: NODE_ID,
      projectId: activeProjectId,
      events,
      state: {
        project: state.project,
        tasks: Array.from(state.tasks.values()),
      },
    });

    for (const client of connectedClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  transport.onMessage(async () => {
    await broadcastStateToUI();
  });

  server.listen(PORT, async () => {
    await bootstrap();
    const url = `http://localhost:${PORT}`;
    console.log(`[WBSer Mode: ${config.mode}] Server running at ${url}`);
    if (config.mode === 'CLIENT' && config.hostAddress) {
      console.log(`[WBSer CLIENT Mode] Configured Host Address: ${config.hostAddress}`);
    }
    if (config.mode !== 'CLIENT') {
      console.log(`[WBSer State Data] Snapshot File: ${SNAPSHOT_FILE}`);
    }

    if (config.autoOpen && process.env.AUTO_OPEN !== 'false') {
      await browserLauncher.open(url);
    }
  });
}

main().catch((err) => {
  console.error('[Fatal Error] Server failed to start:', err);
  process.exit(1);
});
