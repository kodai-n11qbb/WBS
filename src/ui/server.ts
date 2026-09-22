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

  const SNAPSHOT_FILE = path.isAbsolute(config.dataPath)
    ? config.dataPath
    : path.join(process.cwd(), config.dataPath);

  const DATA_DIR = path.dirname(SNAPSHOT_FILE);
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
    if (state.tasks.size === 0) {
      const allEvents = await nodeService.getAllEvents();
      if (allEvents.length === 0) {
        await nodeService.createProject('LAN Share-Log Project');
      }

      // Root 1: Multi-level Core Task
      const root1 = await nodeService.createTask(activeProjectId, {
        title: '親タスク: LAN内P2Pローカルファースト開発',
        priority: 'HIGH',
        status: 'IN_PROGRESS',
      });
      const root1Id = root1.payload.taskId;

      // Mid Level 1 under Root 1
      const mid1 = await nodeService.createTask(activeProjectId, {
        parentId: root1Id,
        title: '中階層: ストレージ＆同期基盤の構築',
        status: 'IN_PROGRESS',
      });
      const mid1Id = mid1.payload.taskId;

      // Leaf tasks under Mid 1
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

      // Mid Level 2 under Root 1
      const mid2 = await nodeService.createTask(activeProjectId, {
        parentId: root1Id,
        title: '中階層: UI＆可視化レイヤーの開発',
        status: 'TODO',
      });
      const mid2Id = mid2.payload.taskId;

      // Leaf tasks under Mid 2
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

      // Root 2: Standalone Task
      await nodeService.createTask(activeProjectId, {
        title: '独立ルートタスク: 全体ロードマップの策定',
        status: 'DONE',
      });
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
          await nodeService.updateTaskStatus(
            activeProjectId,
            data.taskId,
            data.status,
            data.newOrderIndex
          );
          await broadcastStateToUI();
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
        } else if (data.action === 'REORDER_TASK') {
          await nodeService.reorderTask(activeProjectId, data.taskId, data.newOrderIndex);
          await broadcastStateToUI();
        } else if (data.action === 'CHANGE_PARENT') {
          await nodeService.changeTaskParent(activeProjectId, data.taskId, data.newParentId);
          await broadcastStateToUI();
        } else if (data.action === 'TOGGLE_COLLAPSE') {
          // Tree node collapse/expand is local client UI state and excluded from P2P broadcast
        } else if (data.action === 'DELETE_TASK') {
          await nodeService.deleteTask(activeProjectId, data.taskId);
          await broadcastStateToUI();
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
    console.log(`[Share-Log Mode: ${config.mode}] Server running at ${url}`);
    if (config.mode === 'CLIENT' && config.hostAddress) {
      console.log(`[Share-Log CLIENT Mode] Configured Host Address: ${config.hostAddress}`);
    }
    if (config.mode !== 'CLIENT') {
      console.log(`[Share-Log State Data] Snapshot File: ${SNAPSHOT_FILE}`);
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
