"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@colyseus/core");
const ws_transport_1 = require("@colyseus/ws-transport");
const url_1 = __importDefault(require("url"));
const querystring_1 = __importDefault(require("querystring"));
const Lobby_1 = require("./rooms/Lobby");
class DebugWsTransport extends ws_transport_1.WebSocketTransport {
    async onConnection(rawClient, req) {
        // mirror base transport behavior, but use our own seat check to avoid cross-instance mismatch
        rawClient.on("error", (err) => {
            const e = err && err.stack ? err : new Error(String(err));
            // eslint-disable-next-line no-console
            console.error(e);
        });
        rawClient.on("pong", function heartbeat() {
            this.pingCount = 0;
        });
        const upgradeReq = req || rawClient.upgradeReq;
        const parsedURL = url_1.default.parse(upgradeReq?.url ?? "");
        const sessionId = querystring_1.default.parse(parsedURL.query)
            .sessionId;
        const match = parsedURL.pathname.match(/\/[a-zA-Z0-9_\-]+\/([a-zA-Z0-9_\-]+)$/);
        const roomId = match && match[1];
        let room = core_1.matchMaker.getRoomById?.(roomId);
        // Wait briefly for reservation to be registered
        let attempts = 0;
        while (attempts < 50 && (!room || !room.hasReservedSeat(sessionId))) {
            await new Promise((r) => setTimeout(r, 10));
            room = core_1.matchMaker.getRoomById?.(roomId);
            attempts++;
        }
        // eslint-disable-next-line no-console
        console.log("WS onConnection:", upgradeReq?.url, "roomId=", roomId, "sessionId=", sessionId, "room?", !!room, "hasReservedSeat?", room ? room.hasReservedSeat(sessionId) : undefined, "attempts=", attempts);
        const client = new ws_transport_1.WebSocketClient(sessionId, rawClient);
        try {
            if (!room || !room.hasReservedSeat(sessionId)) {
                throw new Error("seat reservation expired.");
            }
            await room._onJoin(client, upgradeReq);
        }
        catch (e) {
            // eslint-disable-next-line no-console
            console.error(e);
            // send error code to client then terminate
            client.error((e && e.code) || 0, e && e.message ? e.message : String(e), () => rawClient.close(1000));
        }
    }
}
const transport = new DebugWsTransport();
const gameServer = new core_1.Server({
    transport,
    presence: new core_1.LocalPresence(), // ensure in-process presence
});
// Seat TTL (seconds) on the global matchmaker (not used by 0.14 for seats, kept for reference)
core_1.matchMaker.seatReservationTimeToLive = 120;
gameServer.define("lobby", Lobby_1.Lobby);
const PORT = Number(process.env.PORT ?? 2567);
gameServer
    .listen(PORT)
    .then(() => console.log(`Colyseus listening on :${PORT}`));
// Debug upgrades to ensure ROOT path & subprotocol
// (cast because ws types may differ depending on transport options)
transport.server?.on("upgrade", (req) => {
    console.log("WS upgrade:", req.url, "protocol:", req.headers["sec-websocket-protocol"]);
});
console.log("seatReservationTimeToLive:", core_1.matchMaker.seatReservationTimeToLive);
if (process.env.COLYSEUS_SEAT_RESERVATION_TIME) {
    console.log("COLYSEUS_SEAT_RESERVATION_TIME:", process.env.COLYSEUS_SEAT_RESERVATION_TIME);
}
//# sourceMappingURL=index.js.map