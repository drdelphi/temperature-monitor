import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { WebSocket, WebSocketServer } from 'ws';
import type { JwtPayload } from '../auth/jwt.strategy';
import { SampleStreamService } from '../events/sample-stream.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  LIVE_WINDOW_MS,
  cookieValue,
  originAllowed,
  parseStreamUpgrade,
  publicLiveSample,
} from './sample-ws.logic';
import { SamplesService } from './samples.service';

type TrackedSocket = WebSocket & { isAlive?: boolean };

@Injectable()
export class SampleWsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(SampleWsService.name);
  private wss: WebSocketServer | null = null;
  private upgradeHandler: ((req: IncomingMessage, socket: Duplex, head: Buffer) => void) | null =
    null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly samples: SamplesService,
    private readonly stream: SampleStreamService,
  ) {}

  onModuleInit() {
    const server = this.adapterHost.httpAdapter.getHttpServer();
    this.wss = new WebSocketServer({ noServer: true });
    this.upgradeHandler = (req, socket, head) => {
      void this.onUpgrade(req, socket, head);
    };
    server.on('upgrade', this.upgradeHandler);
    this.pingTimer = setInterval(() => {
      this.wss?.clients.forEach((client) => {
        const tracked = client as TrackedSocket;
        if (tracked.isAlive === false) {
          tracked.terminate();
          return;
        }
        tracked.isAlive = false;
        tracked.ping();
      });
    }, 30_000);
    this.pingTimer.unref();
  }

  onModuleDestroy() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    const server = this.adapterHost.httpAdapter.getHttpServer();
    if (this.upgradeHandler) server.off('upgrade', this.upgradeHandler);
    this.wss?.clients.forEach((client) => client.close());
    this.wss?.close();
  }

  private reject(socket: Duplex, status: number, reason: string) {
    socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  }

  private corsOrigins(): string[] {
    return (this.config.get<string>('CORS_ORIGINS') ?? 'http://localhost:3000')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  private async onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    const parsed = parseStreamUpgrade(req.url);
    if (!parsed.match) return;
    if (!parsed.deviceId) {
      this.reject(socket, 400, 'Bad Request');
      return;
    }
    if (!originAllowed(req.headers.origin, this.corsOrigins())) {
      this.reject(socket, 403, 'Forbidden');
      return;
    }

    const cookieName = this.config.get<string>('COOKIE_NAME') || 'tm_session';
    const token = cookieValue(req.headers.cookie, cookieName);
    if (!token) {
      this.reject(socket, 401, 'Unauthorized');
      return;
    }

    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user) {
        this.reject(socket, 401, 'Unauthorized');
        return;
      }
      const device = await this.prisma.device.findUnique({ where: { id: parsed.deviceId } });
      if (!device) {
        this.reject(socket, 404, 'Not Found');
        return;
      }
    } catch {
      this.reject(socket, 401, 'Unauthorized');
      return;
    }

    const wss = this.wss;
    if (!wss || socket.destroyed) {
      if (!socket.destroyed) this.reject(socket, 503, 'Service Unavailable');
      return;
    }

    wss.handleUpgrade(req, socket, head, (client) => {
      void this.bindClient(client, parsed.deviceId);
    });
  }

  private async bindClient(client: WebSocket, deviceId: string) {
    const tracked = client as TrackedSocket;
    tracked.isAlive = true;
    client.on('pong', () => {
      tracked.isAlive = true;
    });

    const sub = this.stream.observe(deviceId).subscribe((event) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(publicLiveSample(event)));
      }
    });
    const drop = () => sub.unsubscribe();
    client.on('close', drop);
    client.on('error', () => {
      drop();
      client.close();
    });

    try {
      const from = new Date(Date.now() - LIVE_WINDOW_MS).toISOString();
      const rows = await this.samples.list({ deviceId, from });
      if (client.readyState === WebSocket.OPEN) {
        client.send(
          JSON.stringify({
            samples: rows.map((row) =>
              publicLiveSample({
                deviceId,
                channel: row.channel,
                ts: row.ts,
                tempC: row.tempC,
                rOhm: row.rOhm,
                adcRaw: row.adcRaw,
              }),
            ),
          }),
        );
      }
    } catch (err) {
      this.log.warn(`Live snapshot failed: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }
}
