/**
 * IPC Bridge — Exposes Electron ipcMain handlers via a localhost HTTP server.
 *
 * This module creates a lightweight HTTP server on 127.0.0.1:19847 that maps
 * POST /ipc/<channel> requests to the app's existing ipcMain.handle() handlers.
 *
 * Usage in src/main.ts:
 *   import { startIpcBridge } from './main/ipc-bridge';
 *   // After overlayWindow.registerIpcHandlers()
 *   startIpcBridge();
 */

import * as http from 'http';
import { app, ipcMain } from 'electron';

const PORT = 19847;
const HOST = '127.0.0.1';

let server: http.Server | null = null;

interface IpcInvokeHandler {
  (event: unknown, ...args: unknown[]): unknown;
}

interface IpcMainWithHandlers {
  _invokeHandlers?: Map<string, IpcInvokeHandler>;
}

interface ErrorWithCode extends Error {
  code?: string;
}

/**
 * Get all registered ipcMain handler channel names.
 * Electron doesn't expose a public API for this, so we track them
 * by reading the handler map via internal property.
 */
function getRegisteredChannels(): string[] {
  // ipcMain._invokeHandlers is a Map<string, Function> in Electron internals
  const handlers = (ipcMain as IpcMainWithHandlers)._invokeHandlers;
  if (handlers && typeof handlers.keys === 'function') {
    return Array.from(handlers.keys());
  }
  return [];
}

/**
 * Invoke an ipcMain handler by channel name, as if called from ipcRenderer.invoke().
 */
async function invokeHandler(channel: string, ...args: unknown[]): Promise<unknown> {
  const handlers = (ipcMain as IpcMainWithHandlers)._invokeHandlers;
  if (!handlers || !handlers.has(channel)) {
    throw new Error(`No handler registered for channel: ${channel}`);
  }
  const handler = handlers.get(channel)!;
  // ipcMain handlers receive (event, ...args) — we pass a minimal fake event
  const fakeEvent = { sender: null, senderFrame: null, processId: 0, frameId: 0 };
  return handler(fakeEvent, ...args);
}

export function startIpcBridge(): void {
  if (server) return; // Already running

  // Only enable in dev mode — never expose IPC handlers in production builds
  if (app.isPackaged) {
    console.log('[IPC Bridge] Skipped — disabled in production builds');
    return;
  }

  server = http.createServer(async (req, res) => {
    // CORS headers for local dev tools
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = req.url || '';

    // Health check / channel discovery
    if (url === '/ping' && req.method === 'GET') {
      const channels = getRegisteredChannels();
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, channels }));
      return;
    }

    // IPC handler invocation: POST /ipc/<channel>
    const ipcMatch = url.match(/^\/ipc\/(.+)$/);
    if (ipcMatch && req.method === 'POST') {
      const channel = decodeURIComponent(ipcMatch[1]);

      // Read request body
      let body = '';
      for await (const chunk of req) {
        body += chunk;
      }

      let args: unknown[] = [];
      try {
        const parsed = JSON.parse(body || '{}');
        args = Array.isArray(parsed.args) ? parsed.args : [];
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid JSON body. Expected: {"args": [...]}' }));
        return;
      }

      // Check channel exists
      const channels = getRegisteredChannels();
      if (!channels.includes(channel)) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: `Unknown channel: ${channel}`, available: channels }));
        return;
      }

      try {
        const result = await invokeHandler(channel, ...args);
        res.writeHead(200);
        res.end(JSON.stringify({ result: result ?? null }));
      } catch (err) {
        console.error(`[IPC Bridge] Handler error for '${channel}':`, err);
        res.writeHead(500);
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
      return;
    }

    // Unknown route
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found. Use GET /ping or POST /ipc/<channel>' }));
  });

  server.listen(PORT, HOST, () => {
    console.log(`[IPC Bridge] HTTP bridge listening on http://${HOST}:${PORT}`);
  });

  server.on('error', (err: ErrorWithCode) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[IPC Bridge] Port ${PORT} already in use — bridge may already be running`);
    } else {
      console.error('[IPC Bridge] Server error:', err);
    }
  });
}

export function stopIpcBridge(): void {
  if (server) {
    server.close();
    server = null;
    console.log('[IPC Bridge] HTTP bridge stopped');
  }
}
