import { createSystem } from "@iwsdk/core";
import type { MqttClient } from "mqtt";

import { getGlobals } from "./globals.js";

/**
 * Online match transport for room-code PvP.
 *
 * Uses MQTT over WebSocket on a public broker (no account or server needed;
 * fine for casual play — messages are unauthenticated, so treat rooms as
 * public). Both players subscribe to a topic derived from the room code and
 * exchange tiny JSON messages: hello/hello-ack for presence, move/restart for
 * gameplay. The broker choice is isolated here, so swapping to Supabase/
 * Firebase later only touches this file.
 *
 * Game logic wires itself in via the `onRemoteMove` / `onRemoteRestart` /
 * `onPeerJoined` callbacks (set by GameLogicSystem.init) — keeping imports
 * one-directional (game.ts -> network.ts).
 */

const BROKER_URL = "wss://broker.emqx.io:8084/mqtt";
const TOPIC_PREFIX = "iwsdk-tictactoe/";
// No 0/O/1/I to keep codes easy to read out loud.
const ROOM_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)];
  }
  return code;
}

type WireMessage =
  | { t: "hello"; id: string }
  | { t: "hello-ack"; id: string }
  | { t: "move"; id: string; index: number }
  | { t: "restart"; id: string };

export class OnlineMatchSystem extends createSystem({}) {
  onRemoteMove: ((index: number) => void) | null = null;
  onRemoteRestart: (() => void) | null = null;
  onPeerJoined: (() => void) | null = null;

  private client: MqttClient | null = null;
  private clientId = `ttt-${Math.random().toString(36).slice(2, 10)}`;
  private topic: string | null = null;

  init() {
    const globals = getGlobals(this.world);
    this.cleanupFuncs.push(
      globals.gameMode.subscribe((mode) => {
        if (mode === "online") {
          void this.connect();
        } else {
          this.disconnect();
        }
      }),
      () => this.disconnect(),
    );
  }

  sendMove(index: number) {
    this.publish({ t: "move", id: this.clientId, index });
  }

  sendRestart() {
    this.publish({ t: "restart", id: this.clientId });
  }

  private async connect() {
    if (this.client) {
      return;
    }
    const globals = getGlobals(this.world);
    // Entering online mode without a room (via the panel button) makes this
    // player the host with a fresh code; joining via ?room= URL set the room
    // and guest role at boot.
    if (!globals.onlineRoom.peek()) {
      globals.onlineRoom.value = generateRoomCode();
      globals.onlineRole.value = "host";
    }
    const room = globals.onlineRoom.peek()!;
    this.topic = TOPIC_PREFIX + room;
    globals.onlineStatus.value = "connecting";
    console.log(`[online] room ${room} as ${globals.onlineRole.peek()}`);

    try {
      const { default: mqtt } = await import("mqtt");
      if (globals.gameMode.peek() !== "online") {
        return; // mode changed while the module loaded
      }
      const client = mqtt.connect(BROKER_URL, {
        clientId: this.clientId,
        clean: true,
      });
      this.client = client;

      client.on("connect", () => {
        globals.onlineStatus.value = "connected";
        client.subscribe(this.topic!, (err) => {
          if (!err) {
            this.publish({ t: "hello", id: this.clientId });
          }
        });
      });
      client.on("message", (_topic, payload) => {
        this.handleMessage(payload.toString());
      });
      client.on("error", (error) => {
        console.warn("[online] mqtt error:", error);
        globals.onlineStatus.value = "error";
      });
    } catch (error) {
      console.warn("[online] failed to start transport:", error);
      globals.onlineStatus.value = "error";
    }
  }

  private disconnect() {
    const globals = getGlobals(this.world);
    if (this.client) {
      this.client.end(true);
      this.client = null;
    }
    this.topic = null;
    globals.onlinePeer.value = false;
    globals.onlineStatus.value = "idle";
    globals.onlineRoom.value = null;
    globals.onlineRole.value = null;
  }

  private publish(message: WireMessage) {
    if (this.client && this.topic) {
      this.client.publish(this.topic, JSON.stringify(message));
    }
  }

  private handleMessage(raw: string) {
    let message: WireMessage;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (!message || message.id === this.clientId) {
      return; // our own publish echoed back
    }

    switch (message.t) {
      case "hello":
        // Answer so the newcomer learns we're here, then fall through to
        // registering them as our peer.
        this.publish({ t: "hello-ack", id: this.clientId });
        this.registerPeer();
        break;
      case "hello-ack":
        this.registerPeer();
        break;
      case "move":
        if (typeof message.index === "number") {
          this.registerPeer();
          this.onRemoteMove?.(message.index);
        }
        break;
      case "restart":
        this.onRemoteRestart?.();
        break;
    }
  }

  private registerPeer() {
    const globals = getGlobals(this.world);
    if (!globals.onlinePeer.peek()) {
      globals.onlinePeer.value = true;
      this.onPeerJoined?.();
    }
  }
}
