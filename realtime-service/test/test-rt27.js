import { randomBytes } from "node:crypto";
import { io } from "socket.io-client";

const socketUrl = process.env.TEST_SOCKET_URL || "http://127.0.0.1:4000";

const userAId = "018f0000-0000-7000-8000-0000000000a1";
const deviceAId = "018f0000-0000-7000-8000-0000000000a2";
const sessionAId = "018f0000-0000-7000-8000-0000000000a3";

const userBId = "018f0000-0000-7000-8000-0000000000b1";
const deviceBId = "018f0000-0000-7000-8000-0000000000b2";
const sessionBId = "018f0000-0000-7000-8000-0000000000b3";

const conversationId = "018f0000-0000-7000-8000-00000000c001";

function createUuidV7() {
  const bytes = randomBytes(16);
  const timestamp = BigInt(Date.now());

  bytes[0] = Number((timestamp >> 40n) & 0xffn);
  bytes[1] = Number((timestamp >> 32n) & 0xffn);
  bytes[2] = Number((timestamp >> 24n) & 0xffn);
  bytes[3] = Number((timestamp >> 16n) & 0xffn);
  bytes[4] = Number((timestamp >> 8n) & 0xffn);
  bytes[5] = Number(timestamp & 0xffn);
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

function createDevToken(userId, deviceId, sessionId) {
  return `dev:${userId}:${deviceId}:${sessionId}`;
}

function connectClient(name, token) {
  const socket = io(socketUrl, {
    auth: {
      accessToken: token,
    },
    reconnection: false,
    timeout: 3000,
  });

  socket.on("connect_error", (error) => {
    console.error(`[${name}] connect_error`, error.message);
  });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${name} connect timeout`)), 4000);

    socket.once("connect", () => {
      clearTimeout(timeout);
      console.log(`[${name}] connected ${socket.id}`);
      resolve(socket);
    });
  });
}

function waitForSystemEvent(socket, requestId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timeout waiting system event for ${requestId}`)),
      4000,
    );

    function cleanup() {
      clearTimeout(timeout);
      socket.off("system:ack", onAck);
      socket.off("system:error", onError);
    }

    function onAck(event) {
      if (event.requestId !== requestId) {
        return;
      }

      cleanup();
      resolve({
        kind: "ack",
        event,
      });
    }

    function onError(event) {
      if (event.requestId !== requestId) {
        return;
      }

      cleanup();
      resolve({
        kind: "error",
        event,
      });
    }

    socket.on("system:ack", onAck);
    socket.on("system:error", onError);
  });
}

function waitForChatMessages(socket, durationMs) {
  const messages = [];

  function onMessage(message) {
    messages.push(message);
  }

  socket.on("chat:message", onMessage);

  return new Promise((resolve) => {
    setTimeout(() => {
      socket.off("chat:message", onMessage);
      resolve(messages);
    }, durationMs);
  });
}

async function emitWithSystemResult(socket, eventName, payload) {
  const resultPromise = waitForSystemEvent(socket, payload.requestId);
  socket.emit(eventName, payload);
  return resultPromise;
}

function createChatSendPayload({ requestId, messageId, nonce }) {
  return {
    requestId,
    timestamp: new Date().toISOString(),
    payload: {
      conversationId,
      messageId,
      ciphertext: Buffer.from(`ciphertext-${messageId}`).toString("base64"),
      nonce,
      algorithm: "aes-256-gcm",
      keyVersion: 1,
      clientMessageSeq: 1,
    },
  };
}

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function joinConversation(socket) {
  const requestId = createUuidV7();
  const result = await emitWithSystemResult(socket, "conversation:join", {
    requestId,
    timestamp: new Date().toISOString(),
    payload: {
      conversationId,
    },
  });

  assertCondition(result.kind === "ack", "conversation:join must ack");
}

async function main() {
  console.log(`[RT-27] Testing against ${socketUrl}`);

  const socketA = await connectClient("A", createDevToken(userAId, deviceAId, sessionAId));
  const socketB = await connectClient("B", createDevToken(userBId, deviceBId, sessionBId));

  try {
    await joinConversation(socketA);
    await joinConversation(socketB);

    const requestId = createUuidV7();
    const messageId = createUuidV7();
    const nonce = Buffer.from("rt27-unique-nonce").toString("base64");
    const firstPayload = createChatSendPayload({ requestId, messageId, nonce });

    const firstMessagesPromise = waitForChatMessages(socketB, 500);
    const firstResult = await emitWithSystemResult(socketA, "chat:send", firstPayload);
    const firstMessages = await firstMessagesPromise;

    assertCondition(firstResult.kind === "ack", "first chat:send must ack");
    assertCondition(firstMessages.length === 1, "first chat:send must fanout exactly one chat:message");
    console.log("[RT-27] First send acked and fanout once");

    const duplicateMessagesPromise = waitForChatMessages(socketB, 500);
    const duplicateResult = await emitWithSystemResult(socketA, "chat:send", firstPayload);
    const duplicateMessages = await duplicateMessagesPromise;

    assertCondition(duplicateResult.kind === "ack", "duplicate chat:send must return ack");
    assertCondition(
      duplicateResult.event.meta?.dedupedByRealtime === true,
      "duplicate ack must include dedupedByRealtime=true",
    );
    assertCondition(
      duplicateMessages.length === 0,
      "duplicate chat:send must not fanout another chat:message",
    );
    console.log("[RT-27] Duplicate request was deduped without fanout");

    const replayPayload = createChatSendPayload({
      requestId: createUuidV7(),
      messageId: createUuidV7(),
      nonce,
    });
    const replayResult = await emitWithSystemResult(socketA, "chat:send", replayPayload);

    assertCondition(replayResult.kind === "error", "nonce replay must return system:error");
    assertCondition(
      replayResult.event.errorCode === "REPLAY_DETECTED",
      "nonce replay must return REPLAY_DETECTED",
    );
    console.log("[RT-27] Nonce replay was blocked with REPLAY_DETECTED");

    console.log("[RT-27] PASS");
  } finally {
    socketA.disconnect();
    socketB.disconnect();
  }
}

main().catch((error) => {
  console.error("[RT-27] FAIL");
  console.error(error);
  process.exitCode = 1;
});
