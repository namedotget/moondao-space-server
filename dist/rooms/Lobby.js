"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Lobby = void 0;
const core_1 = require("@colyseus/core");
const State_1 = require("../schema/State");
const zod_1 = require("zod");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const MoveMsg = zod_1.z.object({ x: zod_1.z.number(), y: zod_1.z.number() });
const VoiceMsg = zod_1.z.object({
    data: zod_1.z
        .instanceof(ArrayBuffer)
        .or(zod_1.z.array(zod_1.z.number()))
        .or(zod_1.z.instanceof(Buffer))
        .optional(),
    frames: zod_1.z.array(zod_1.z.any()).optional(), // Allow any frame format
    sample_rate: zod_1.z.number().optional(),
    format: zod_1.z.string().optional(),
});
class Lobby extends core_1.Room {
    constructor() {
        super(...arguments);
        this.maxClients = 64;
    }
    async onCreate(options) {
        this.setState(new State_1.RoomState());
        // Extend seat reservation TTL to avoid early expiration during WebSocket upgrade in dev
        try {
            this.setSeatReservationTime?.(300);
            console.log("Lobby onCreate: seatReservationTime=", this.seatReservationTime);
        }
        catch { }
        this.onMessage("move", (client, payload) => {
            const { x, y } = MoveMsg.parse(payload);
            const p = this.state.players.get(client.sessionId);
            if (!p)
                return;
            // Apply movement delta (server-authoritative)
            const oldX = p.x;
            const oldY = p.y;
            p.x += x;
            p.y += y;
            // Debug logging (remove after testing)
            if (Math.abs(x) > 0.1 || Math.abs(y) > 0.1) {
                console.log(`Player ${client.sessionId} moved by (${x.toFixed(2)}, ${y.toFixed(2)}) to (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`);
            }
            // Optional: clamp to world bounds
            // p.x = Math.max(0, Math.min(p.x, 2000));
            // p.y = Math.max(0, Math.min(p.y, 2000));
        });
        this.onMessage("voice_data", (client, payload) => {
            try {
                console.log("Voice data received from", client.sessionId, "payload:", typeof payload, "keys:", Object.keys(payload));
                // Handle both formats: legacy bytes and new frames
                if (!payload || (!payload.data && !payload.frames)) {
                    console.error("Voice data missing - no data or frames field");
                    return;
                }
                const { data, frames, sample_rate, format } = payload;
                // Broadcast voice data to all other clients with the sender's session ID
                const broadcastPayload = {
                    session_id: client.sessionId,
                    sample_rate: sample_rate || 22050,
                    format: format || "bytes"
                };
                // Include the appropriate data field
                if (format === "frames" && frames) {
                    broadcastPayload.frames = frames;
                    console.log("Broadcasting frames data from", client.sessionId, "- frame count:", frames.length);
                }
                else if (data) {
                    broadcastPayload.data = data;
                    console.log("Broadcasting byte data from", client.sessionId, "- size:", data.length || data.byteLength || "unknown");
                }
                else {
                    console.error("No valid data field found");
                    return;
                }
                this.broadcast("voice_data", broadcastPayload, { except: client });
                console.log(`Voice data from ${client.sessionId}, size: ${data instanceof ArrayBuffer
                    ? data.byteLength
                    : data.length || data.byteLength || "unknown"}`);
            }
            catch (error) {
                console.error("Error processing voice data:", error);
            }
        });
    }
    async onAuth(client, options, request) {
        // Accept JWT passed via query (?token=...) or options, but do not require it in dev
        const urlToken = new URL(request.url, "http://x").searchParams.get("token");
        const optToken = options?.token;
        const token = optToken || urlToken;
        if (token) {
            try {
                const payload = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
                const sub = payload?.sub ?? "";
                const name = payload?.name ?? payload?.wallet ?? "Anon";
                client.user = { id: String(sub), name };
                console.log("on Auth ok", payload);
                return true;
            }
            catch (e) {
                console.warn("JWT verify failed, falling back to anon user");
            }
        }
        // Fallback: allow connection without token (dev) – identify by sessionId
        client.user = { id: client.sessionId, name: "Anon" };
        return true;
    }
    onJoin(client) {
        const user = client.user;
        const p = new State_1.Player();
        p.id = String(user.id);
        p.name = user.name;
        this.state.players.set(client.sessionId, p);
        console.log("onJoin", client.sessionId);
        console.log("players size", this.state.players.size);
        // (message-based sync removed; rely on schema)
    }
    onLeave(client) {
        this.state.players.delete(client.sessionId);
        // (message-based sync removed)
    }
}
exports.Lobby = Lobby;
//# sourceMappingURL=Lobby.js.map