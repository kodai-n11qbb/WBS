import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { NodeService } from '../core/node_service.js';
import { InMemoryRepository } from '../adapters/in_memory_repository.js';
import { UdpPeerTransport } from '../adapters/udp_peer_discovery.js';
import { SyncEngine } from '../domain/sync_engine.js';
import { crypto } from '../core/crypto_util.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, '../../public');

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const NODE_ID = process.env.NODE_ID || `node-${crypto.randomUUID().slice(0, 6)}`;
const UDP_PORT = process.env.UDP_PORT ? parseInt(process.env.UDP_PORT, 10) : 41234;

// 1. Dependency Injection setup according to DEV_POLICY_v1.0518.md
const repository = new InMemoryRepository();
const transport = new UdpPeerTransport({ nodeId: NODE_ID, port: UDP_PORT });
const syncEngine = new SyncEngine();

const nodeService = new NodeService({
  nodeId: NODE_ID,
  repository,
  transport,
  syncEngine,
});

// Initialize default project if none exists
let activeProjectId = 'default-project';

async function bootstrap() {
  await nodeService.start();
  const allEvents = await nodeService.getAllEvents();
  if (allEvents.length === 0) {
    await nodeService.createProject('LAN Share-Log Project');
    await nodeService.createTask(activeProjectId, 'ローカルファーストP2P構造の検証', 'DONE');
    await nodeService.createTask(activeProjectId, 'LAN内ノードの分散同期テスト', 'IN_PROGRESS');
    await nodeService.createTask(activeProjectId, 'マルチプラットフォームパッケージ化 (.exe/.app)', 'TODO');
  }

  console.log(`[NodeService] Started Node "${NODE_ID}" on UDP port ${UDP_PORT}`);
}

// HTTP Server for Static Assets
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

// WebSocket Server for UI Updates
const wss = new WebSocketServer({ server });
const connectedClients = new Set<WebSocket>();

wss.on('connection', async (ws) => {
  connectedClients.add(ws);

  // Send current state on connection
  const state = await nodeService.getProjectState(activeProjectId);
  ws.send(JSON.stringify({
    type: 'STATE_INIT',
    nodeId: NODE_ID,
    projectId: activeProjectId,
    state: {
      project: state.project,
      tasks: Array.from(state.tasks.values()),
    },
  }));

  ws.on('message', async (rawMessage) => {
    try {
      const data = JSON.parse(rawMessage.toString());
      if (data.action === 'CREATE_TASK') {
        await nodeService.createTask(activeProjectId, data.title, 'TODO');
        await broadcastStateToUI();
      } else if (data.action === 'UPDATE_STATUS') {
        await nodeService.updateTaskStatus(activeProjectId, data.taskId, data.status);
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

// Subscribe NodeService transport to trigger UI broadcasts on P2P updates
transport.onMessage(async () => {
  await broadcastStateToUI();
});

server.listen(PORT, async () => {
  await bootstrap();
  console.log(`[Share-Log Web UI] Server running at http://localhost:${PORT}`);
});
