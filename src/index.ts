import { Server, matchMaker, LocalPresence } from "@colyseus/core";
import { WebSocketTransport, WebSocketClient } from "@colyseus/ws-transport";
import url from "url";
import querystring from "querystring";
import { Lobby } from "./rooms/Lobby";

class DebugWsTransport extends WebSocketTransport {
  async onConnection(rawClient: any, req: any) {
    // mirror base transport behavior, but use our own seat check to avoid cross-instance mismatch
    (rawClient as any).on("error", (err: any) => {
      const e = err && err.stack ? err : new Error(String(err));
      // eslint-disable-next-line no-console
      console.error(e);
    });
    (rawClient as any).on("pong", function heartbeat(this: any) {
      this.pingCount = 0;
    });

    const upgradeReq: any = req || (rawClient as any).upgradeReq;
    const parsedURL = url.parse(upgradeReq?.url ?? "");
    const sessionId = (querystring.parse(parsedURL.query as any) as any)
      .sessionId as string;
    const match = (parsedURL.pathname as string).match(
      /\/[a-zA-Z0-9_\-]+\/([a-zA-Z0-9_\-]+)$/
    );
    const roomId = match && match[1];
    let room = (matchMaker as any).getRoomById?.(roomId);

    // Wait briefly for reservation to be registered
    let attempts = 0;
    while (attempts < 50 && (!room || !room.hasReservedSeat(sessionId))) {
      await new Promise((r) => setTimeout(r, 10));
      room = (matchMaker as any).getRoomById?.(roomId);
      attempts++;
    }

    // eslint-disable-next-line no-console
    console.log(
      "WS onConnection:",
      upgradeReq?.url,
      "roomId=",
      roomId,
      "sessionId=",
      sessionId,
      "room?",
      !!room,
      "hasReservedSeat?",
      room ? room.hasReservedSeat(sessionId) : undefined,
      "attempts=",
      attempts
    );

    const client = new WebSocketClient(sessionId, rawClient);
    try {
      if (!room || !room.hasReservedSeat(sessionId)) {
        throw new Error("seat reservation expired.");
      }
      await (room as any)._onJoin(client, upgradeReq);
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.error(e);
      // send error code to client then terminate
      (client as any).error(
        (e && e.code) || 0,
        e && e.message ? e.message : String(e),
        () => (rawClient as any).close(1000)
      );
    }
  }
}

// Add startup logging
console.log("🚀 Starting Colyseus server...");
console.log("📊 Environment variables:");
console.log("  - NODE_ENV:", process.env.NODE_ENV);
console.log("  - PORT:", process.env.PORT);
console.log(
  "  - JWT_SECRET:",
  process.env.JWT_SECRET ? "✅ Set" : "❌ Missing"
);

// Global error handlers
process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught Exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

const transport = new DebugWsTransport();
console.log("✅ Transport created");

const gameServer = new Server({
  transport,
  presence: new LocalPresence(), // ensure in-process presence
});
console.log("✅ Game server created");

// Seat TTL (seconds) on the global matchmaker (not used by 0.14 for seats, kept for reference)
(matchMaker as any).seatReservationTimeToLive = 120;

console.log("🏠 Defining lobby room...");
try {
  gameServer.define("lobby", Lobby);
  console.log("✅ Lobby room defined successfully");
} catch (error) {
  console.error("❌ Failed to define lobby room:", error);
  process.exit(1);
}

const PORT = Number(process.env.PORT ?? 2567);
console.log("🔌 Attempting to listen on port:", PORT);

gameServer
  .listen(PORT)
  .then(() => {
    console.log(`🎉 Colyseus listening on :${PORT}`);
    console.log("🌐 Server is ready to accept connections");
    console.log("📡 WebSocket endpoint: wss://moondao-space-server.fly.dev/");

    // REMOVED: Conflicting HTTP request handler
    // Only add connection logging for WebSockets
    const server = (transport as any).server;
    if (server) {
      server.on("connection", (socket: any) => {
        console.log("🔌 Raw WebSocket connection established");
      });
    }
  })
  .catch((error) => {
    console.error("💥 Failed to start server:", error);
    console.error("Stack:", error.stack);
    process.exit(1);
  });

// Debug upgrades to ensure ROOT path & subprotocol
// (cast because ws types may differ depending on transport options)
(transport.server as any)?.on("upgrade", (req: any) => {
  console.log(
    "🔄 WS upgrade:",
    req.url,
    "protocol:",
    req.headers["sec-websocket-protocol"]
  );
});

console.log(
  "⏰ seatReservationTimeToLive:",
  (matchMaker as any).seatReservationTimeToLive
);
if (process.env.COLYSEUS_SEAT_RESERVATION_TIME) {
  console.log(
    "⏰ COLYSEUS_SEAT_RESERVATION_TIME:",
    process.env.COLYSEUS_SEAT_RESERVATION_TIME
  );
}

// Handle process termination gracefully
process.on("SIGTERM", () => {
  console.log("📴 Received SIGTERM, shutting down gracefully");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("📴 Received SIGINT, shutting down gracefully");
  process.exit(0);
});

console.log("✅ Server initialization complete");
