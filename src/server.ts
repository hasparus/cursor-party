import {
  Server,
  routePartykitRequest,
  type Connection,
  type ConnectionContext,
  type WSMessage,
} from "partyserver";
import type {
  Metadata,
  Presence,
  User,
  PartyMessage,
} from "./presence/presence-schema";
import {
  clientMessageSchema,
  decodeMessage,
  encodePartyMessage,
} from "./presence/presence-schema";

type Env = {
  main: DurableObjectNamespace<PresenceServer>;
  ASSETS: Fetcher;
  WEBSITES: string[];
};

export type ConnectionWithUser = Connection<{
  metadata?: Metadata;
  presence?: Presence;
}>;

const BROADCAST_INTERVAL = 1000 / 60; // 60fps

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET",
  "Access-Control-Allow-Headers":
    "Origin, X-Requested-With, Content-Type, Accept",
};

export class PresenceServer extends Server<Env> {
  static options = { hibernate: true };

  // pending updates are stored in memory and sent every tick
  add: { [id: string]: User } = {};
  presence: { [id: string]: Presence } = {};
  remove: string[] = [];

  lastBroadcast = 0;
  interval: ReturnType<typeof setInterval> | null = null;

  onConnect(connection: ConnectionWithUser, { request }: ConnectionContext) {
    const metadata = { country: request.cf?.country ?? null } as Metadata;

    // The client may set name and color (from the presence object) in the query string
    const params = new URL(request.url).searchParams;
    const presence = {
      name: params.get("name") ?? undefined,
      color: params.get("color"),
    } as Presence;

    // Stash the metadata and the presence on the websocket
    connection.setState((prevState) => ({
      presence: { ...prevState?.presence, ...presence },
      metadata,
    }));

    this.join(connection);
  }

  enqueueAdd(id: string, user: User) {
    this.add[id] = user;
  }

  enqueuePresence(id: string, presence: Presence) {
    this.presence[id] = presence;
  }

  enqueueRemove(id: string) {
    this.remove.push(id);
    delete this.presence[id];
  }

  getUser(connection: ConnectionWithUser): User {
    return {
      presence: connection.state?.presence ?? ({} as Presence),
      metadata: connection.state?.metadata ?? ({} as Metadata),
    };
  }

  makeSyncMessage() {
    const users = <Record<string, User>>{};
    for (const connection of this.getConnections<ConnectionWithUser["state"]>()) {
      users[connection.id] = this.getUser(connection);
    }

    return {
      type: "sync",
      users,
    } satisfies PartyMessage;
  }

  join(connection: ConnectionWithUser) {
    this.enqueueAdd(connection.id, this.getUser(connection));
    // Reply with the current presence of all connections, including self
    connection.send(encodePartyMessage(this.makeSyncMessage()));
  }

  leave(connection: ConnectionWithUser) {
    this.enqueueRemove(connection.id);
    this.broadcastChanges();
  }

  onMessage(connection: ConnectionWithUser, msg: WSMessage) {
    const result = clientMessageSchema.safeParse(decodeMessage(msg));
    if (!result.success) return;
    const message = result.data;
    switch (message.type) {
      case "update": {
        // A presence update, replacing the existing presence
        this.enqueuePresence(connection.id, message.presence);
        connection.setState((prevState) => ({
          ...prevState,
          presence: message.presence,
        }));
        break;
      }
    }

    this.broadcastChanges();
  }

  onClose(connection: ConnectionWithUser) {
    this.leave(connection);
  }

  onError(connection: ConnectionWithUser) {
    this.leave(connection);
  }

  broadcastChanges() {
    // Broadcasts deltas. Looks at lastBroadcast
    // - If it's longer ago than BROADCAST_INTERVAL, broadcasts immediately
    // - If it's less than BROADCAST_INTERVAL ago, schedules a broadcast later
    const ago = Date.now() - this.lastBroadcast;
    if (ago >= BROADCAST_INTERVAL) {
      this.flush();
    } else if (!this.interval) {
      this.interval = setInterval(() => {
        this.flush();
        if (this.interval) {
          clearInterval(this.interval);
          this.interval = null;
        }
      }, BROADCAST_INTERVAL - ago);
    }
  }

  flush() {
    this.lastBroadcast = Date.now();

    // Avoid the situation where there's only one connection and we're
    // rebroadcasting its own deltas to it
    const connections = [...this.getConnections()];
    const presenceUniqueIds = new Set(Object.keys(this.presence));
    if (
      connections.length === 1 &&
      this.remove.length === 0 &&
      Object.keys(this.add).length === 0 &&
      presenceUniqueIds.size === 1 &&
      presenceUniqueIds.has(connections[0].id)
    ) {
      this.presence = {};
      return;
    }

    const update = {
      type: "changes",
      add: this.add,
      presence: this.presence,
      remove: this.remove,
    } satisfies PartyMessage;
    this.broadcast(encodePartyMessage(update));
    this.add = {};
    this.presence = {};
    this.remove = [];
  }

  onRequest(req: Request) {
    if (req.method === "GET") {
      // For SSR, return the current presence of all connections
      const users: Record<string, User> = {};
      for (const connection of this.getConnections<ConnectionWithUser["state"]>()) {
        users[connection.id] = this.getUser(connection);
      }
      return Response.json({ users }, { headers: CORS });
    }

    // respond to cors preflight requests
    if (req.method === "OPTIONS") {
      return Response.json({ ok: true }, { headers: CORS });
    }

    return new Response("Method Not Allowed", { status: 405 });
  }
}

function isAllowed(from: string, websites: string[]) {
  const homeURL = new URL(from);
  if (["localhost", "127.0.0.1", "0.0.0.0"].includes(homeURL.hostname)) {
    return true;
  }

  const matchWith = homeURL.origin + homeURL.pathname;
  return websites.some((site) => new URLPattern(site).test(matchWith));
}

function reject() {
  // close the socket with a reason, so the browser can log why
  const [client, server] = Object.values(new WebSocketPair());
  server.accept();
  server.close(1008, "This page is not in the WEBSITES allowlist");
  return new Response(null, { status: 101, webSocket: client });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (url.pathname === "/meta.js") {
      return new Response(
        `window.__WEBSITES__ = ${JSON.stringify(JSON.stringify(env.WEBSITES))};`,
        { headers: { "Content-Type": "text/javascript" } }
      );
    }

    return (
      (await routePartykitRequest(req, env, {
        onBeforeConnect(req) {
          // the page the cursors are on is passed in the "from" query param
          const from = new URL(req.url).searchParams.get("from");
          if (!from) return new Response("Not Allowed", { status: 403 });
          if (!isAllowed(from, env.WEBSITES)) {
            return reject();
          }
        },
      })) ?? env.ASSETS.fetch(req)
    );
  },
} satisfies ExportedHandler<Env>;
