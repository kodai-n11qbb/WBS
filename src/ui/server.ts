import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { NodeService } from '../core/node_service.js';
import { JsonlFileRepository } from '../adapters/jsonl_repository.js';
import { UdpPeerTransport } from '../adapters/udp_peer_discovery.js';
import { SyncEngine } from '../domain/sync_engine.js';
import { StructuredTaskValidator } from '../domain/task_validator.js';
import { crypto } from '../core/crypto_util.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, '../../public');
const DATA_FILE = path.join(__dirname, '../../data/events.jsonl');

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const NODE_ID = process.env.NODE_ID || `node-${crypto.randomUUID().slice(0, 6)}`;
const UDP_PORT = process.env.UDP_PORT ? parseInt(process.env.UDP_PORT, 10) : 41234;

// 1. Dependency Injection setup according to DEV_POLICY_v1.0518.md
const repository = new JsonlFileRepository(DATA_FILE);
const transport = new UdpPeerTransport({ nodeId: NODE_ID, port: UDP_PORT });
const syncEngine = new SyncEngine();
const validator = new StructuredTaskValidator();

const nodeService = new NodeService({
  nodeId: NODE_ID,
  repository,
  transport,
  syncEngine,
  validator,
});

let activeProjectId = 'default-project';

async function bootstrap() {
  await repository.init();
  await nodeService.start();

  const allEvents = await nodeService.getAllEvents();
  if (allEvents.length === 0) {
    await nodeService.createProject('LAN Share-Log Project');

    const parentEvent = await nodeService.createTask(activeProjectId, {
      title: '親タスク: LAN内P2Pローカルファースト開発',
      priority: 'HIGH',
      status: 'IN_PROGRESS',
    });

    const parentId = parentEvent.payload.taskId;

    await nodeService.createTask(activeProjectId, {
      parentId,
      title: '子タスク 1: JSONLファイル永続化の検証',
      status: 'DONE',
    });

    await nodeService.createTask(activeProjectId, {
      parentId,
      title: '子タスク 2: ツリー構造・Drag&Dropの確認',
      status: 'TODO',
    });
  }

  console.log(`[NodeService] Started Node "${NODE_ID}" with JSONL storage at: ${DATA_FILE}`);
}

const server = http.createServer((req, res) => {
  let filePath = path.join(PUBLIC_DIR, req.url === '/' ? 'index.html' : req.url || 'index.html');

  const ext = path.extname(filePath);
  let contentType = 'text/html';
  if (ext === '.css') contentType = 'text/css';
  if (ext === '.js') contentType = 'text/javascript';
  if (ext === '.json') contentType = 'application/json';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<h1>404 Not Found</h1>');
      } else {
        res.writeHead(500);
        res.end(`Server Error: ${err.code}`);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

const wss = new WebSocketServer({ server });
const connectedClients = new Set<WebSocket>();

wss.on('connection', async (ws) => {
  connectedClients.add(ws);

  const state = await nodeService.getProjectState(activeProjectId);
  ws.send(
    JSON.stringify({
      type: 'STATE_INIT',
      nodeId: NODE_ID,
      projectId: activeProjectId,
      dataFile: DATA_FILE,
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
      } else if (data.action === 'REORDER_TASK') {
        await nodeService.reorderTask(activeProjectId, data.taskId, data.newOrderIndex);
        await broadcastStateToUI();
      } else if (data.action === 'CHANGE_PARENT') {
        await nodeService.changeTaskParent(activeProjectId, data.taskId, data.newParentId);
        await broadcastStateToUI();
      } else if (data.action === 'TOGGLE_COLLAPSE') {
        await nodeService.toggleTaskCollapse(activeProjectId, data.taskId, data.isCollapsed);
        await broadcastStateToUI();
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
  const payload = JSON.stringify({
    type: 'STATE_UPDATE',
    nodeId: NODE_ID,
    projectId: activeProjectId,
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
  console.log(`[Share-Log Web UI] Server running at http://localhost:${PORT}`);
});
