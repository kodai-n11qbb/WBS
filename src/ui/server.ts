import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
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
import { FsFileWatcherAdapter } from '../adapters/fs_file_watcher.js';

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

function checkPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => {
        resolve(false);
      })
      .once('listening', () => {
        tester.close(() => resolve(true));
      })
      .listen(port);
  });
}

async function findAvailablePort(startPort: number, maxPort: number): Promise<number> {
  for (let port = startPort; port <= maxPort; port++) {
    const isAvail = await checkPortAvailable(port);
    if (isAvail) return port;
  }
  throw new Error(`利用可能なポートが見つかりませんでした (${startPort} - ${maxPort})`);
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

  const requestedPort = config.port;
  const PORT = await findAvailablePort(requestedPort, Math.max(requestedPort + 50, 3050));
  if (PORT !== requestedPort) {
    console.log(`[WBSer Port] ポート ${requestedPort} は使用中のため、空きポート ${PORT} で起動します。`);
  }
  const NODE_ID = config.nodeName;
  const UDP_PORT = config.udpPort;

  // 1. Dependency Injection setup according to DEV_POLICY_v1.0518.md
  const repository = new JsonlFileRepository(DATA_FILE);
  const snapshotExporter = new JsonStateSnapshotExporter(SNAPSHOT_FILE);
  const transport = new UdpPeerTransport({ nodeId: NODE_ID, port: UDP_PORT });
  const browserLauncher = new SystemBrowserLauncher();
  const syncEngine = new SyncEngine();
  const validator = new StructuredTaskValidator();
  const fileWatcher = new FsFileWatcherAdapter(150);

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

    // Start watching DATA_DIR for external modifications
    fileWatcher.startWatching(DATA_DIR, async (changedPath) => {
      if (repository.reloadFromDisk) {
        const newEventsCount = await repository.reloadFromDisk();
        if (newEventsCount > 0) {
          console.log(`[FileWatcher] Detected external modification at ${changedPath}. Reloaded ${newEventsCount} events.`);
          await broadcastStateToUI();
        }
      }
    });

    const existingSnapshot = await snapshotExporter.loadSnapshot();
    const allEvents = await nodeService.getAllEvents();

    const existingProjectEvent = allEvents.find((e) => e.type === 'PROJECT_CREATED');
    if (existingSnapshot && existingSnapshot.projectId) {
      activeProjectId = existingSnapshot.projectId;
    } else if (existingProjectEvent && existingProjectEvent.projectId) {
      activeProjectId = existingProjectEvent.projectId;
    }

    const hasSnapshotTasks = Boolean(
      existingSnapshot && Array.isArray(existingSnapshot.tasks) && existingSnapshot.tasks.length > 0
    );
    const hasEventTasks = allEvents.some((e) => e.type === 'TASK_CREATED');

    if (!hasEventTasks && hasSnapshotTasks && existingSnapshot) {
      console.log(`[Bootstrap] Hydrating ${existingSnapshot.tasks.length} tasks from existing state.json...`);
      const pId = existingSnapshot.projectId || activeProjectId;
      activeProjectId = pId;
      if (!existingProjectEvent) {
        await nodeService.createProject(existingSnapshot.projectName || 'LAN Share-Log Project');
      }

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
    } else if (!hasEventTasks && !hasSnapshotTasks && process.env.CREATE_DEMO_TASKS !== 'false') {
      console.log('[Bootstrap] データが存在しないため、直近の架空予定（サンプルタスク群）を生成します...');
      if (!existingProjectEvent) {
        const projEvt = await nodeService.createProject('LAN Share-Log Project');
        activeProjectId = projEvt.projectId;
      }

      const now = Date.now();
      const DAY_MS = 86400000;
      const getTargetDate = (daysOffset: number): number => {
        const d = new Date(now + daysOffset * DAY_MS);
        d.setHours(23, 59, 59, 999);
        return d.getTime();
      };

      // 1. 親タスク: Webサービス リニューアルPJ (進行中 / 期限: 12日後)
      const root1 = await nodeService.createTask(activeProjectId, {
        title: '親タスク: Webサービス リニューアルPJ',
        priority: 'HIGH',
        status: 'IN_PROGRESS',
        orderIndex: 1,
        dueDate: getTargetDate(12),
      });
      const root1Id = root1.payload.taskId;

      // 1-1. 中階層: 要件定義・基本設計 (完了 / 期限: 2日前)
      const mid1 = await nodeService.createTask(activeProjectId, {
        parentId: root1Id,
        title: '中階層: 要件定義・基本設計',
        priority: 'HIGH',
        status: 'DONE',
        orderIndex: 1,
        dueDate: getTargetDate(-2),
      });
      const mid1Id = mid1.payload.taskId;

      await nodeService.createTask(activeProjectId, {
        parentId: mid1Id,
        title: '子タスク: Local-First同期プロトコル策定',
        status: 'DONE',
        priority: 'HIGH',
        orderIndex: 1,
        dueDate: getTargetDate(-4),
      });

      await nodeService.createTask(activeProjectId, {
        parentId: mid1Id,
        title: '子タスク: データスキーマ＆JSONL仕様確定',
        status: 'DONE',
        priority: 'MEDIUM',
        orderIndex: 2,
        dueDate: getTargetDate(-2),
      });

      // 1-2. 中階層: フロントエンド＆UI実装 (進行中 / 期限: 5日後)
      const mid2 = await nodeService.createTask(activeProjectId, {
        parentId: root1Id,
        title: '中階層: フロントエンド＆UI実装',
        priority: 'HIGH',
        status: 'IN_PROGRESS',
        orderIndex: 2,
        dueDate: getTargetDate(5),
      });
      const mid2Id = mid2.payload.taskId;

      await nodeService.createTask(activeProjectId, {
        parentId: mid2Id,
        title: '子タスク: Obsidian風ノードグラフの物理演算調整',
        status: 'DONE',
        priority: 'MEDIUM',
        orderIndex: 1,
        dueDate: getTargetDate(-1),
      });

      await nodeService.createTask(activeProjectId, {
        parentId: mid2Id,
        title: '子タスク: タイムライン・ガントチャート描画の実装',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        orderIndex: 2,
        dueDate: getTargetDate(2),
      });

      await nodeService.createTask(activeProjectId, {
        parentId: mid2Id,
        title: '子タスク: WebSocketリアルタイム反映の検証',
        status: 'TODO',
        priority: 'HIGH',
        orderIndex: 3,
        dueDate: getTargetDate(5),
      });

      // 1-3. 中階層: テスト＆リリース準備 (未着手 / 期限: 10日後)
      const mid3 = await nodeService.createTask(activeProjectId, {
        parentId: root1Id,
        title: '中階層: テスト＆リリース準備',
        priority: 'MEDIUM',
        status: 'TODO',
        orderIndex: 3,
        dueDate: getTargetDate(10),
      });
      const mid3Id = mid3.payload.taskId;

      await nodeService.createTask(activeProjectId, {
        parentId: mid3Id,
        title: '子タスク: 複数ノード間P2P同期の結合テスト',
        status: 'TODO',
        priority: 'MEDIUM',
        orderIndex: 1,
        dueDate: getTargetDate(8),
      });

      await nodeService.createTask(activeProjectId, {
        parentId: mid3Id,
        title: '子タスク: スタンドアロンバイナリのパッケージング',
        status: 'TODO',
        priority: 'LOW',
        orderIndex: 2,
        dueDate: getTargetDate(10),
      });

      // 2. 独立タスク: 全体キックオフ＆進捗定例ミーティング (進行中 / 期限: 明日)
      await nodeService.createTask(activeProjectId, {
        title: '独立タスク: 全体キックオフ＆進捗定例ミーティング',
        priority: 'HIGH',
        status: 'IN_PROGRESS',
        orderIndex: 2,
        dueDate: getTargetDate(1),
      });

      console.log('[Bootstrap] 直近の架空予定の生成が完了しました。');
    } else if (!hasEventTasks && !existingProjectEvent) {
      console.log('[Bootstrap] No existing events or snapshot found. Initializing clean project...');
      const projEvt = await nodeService.createProject('LAN Share-Log Project');
      activeProjectId = projEvt.projectId;
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

  const isPkg = (process as any).pkg !== undefined;
  const enableAutoExit = isPkg || process.env.AUTO_EXIT === 'true';
  let exitTimer: NodeJS.Timeout | null = null;
  let hasEverConnected = false;

  const cancelExitTimer = () => {
    if (exitTimer) {
      clearTimeout(exitTimer);
      exitTimer = null;
    }
  };

  const scheduleExit = () => {
    if (!enableAutoExit) return;
    if (!hasEverConnected) return;
    if (connectedClients.size > 0) return;

    cancelExitTimer();
    console.log('[WBSer Auto-Exit] ブラウザ切断を検知しました。4秒後にプロセスを終了します（再接続待機中）...');
    exitTimer = setTimeout(async () => {
      if (connectedClients.size === 0) {
        console.log('[WBSer Auto-Exit] ブラウザが終了したため、サーバープロセスを安全にシャットダウンします。');
        try {
          await nodeService.stop();
        } catch {}
        process.exit(0);
      }
    }, 4000);
  };

  const wss = new WebSocketServer({ server });
  const connectedClients = new Set<WebSocket>();

  wss.on('connection', async (ws) => {
    connectedClients.add(ws);
    hasEverConnected = true;
    cancelExitTimer();

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
      if (connectedClients.size === 0) {
        scheduleExit();
      }
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
    console.log(`[WBSer] Server running at ${url}`);
    console.log(`[WBSer Data] Snapshot File: ${SNAPSHOT_FILE}`);

    if (config.autoOpen && process.env.AUTO_OPEN !== 'false') {
      await browserLauncher.open(url);
    }
  });
}

main().catch((err) => {
  console.error('[Fatal Error] Server failed to start:', err);
  process.exit(1);
});
