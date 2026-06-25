import { randomBytes } from "node:crypto";
import { io } from "socket.io-client";

const socketUrl = process.env.TEST_SOCKET_URL || "http://127.0.0.1:4000";
const conversationId = "018f0000-0000-7000-8000-00000000c001";

const users = {
  a: {
    userId: "018f0000-0000-7000-8000-0000000000a1",
    deviceId: "018f0000-0000-7000-8000-0000000000a2",
    sessionId: "018f0000-0000-7000-8000-0000000000a3",
  },
  b: {
    userId: "018f0000-0000-7000-8000-0000000000b1",
    deviceId: "018f0000-0000-7000-8000-0000000000b2",
    sessionId: "018f0000-0000-7000-8000-0000000000b3",
  },
};

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

function createDevToken({ userId, deviceId, sessionId }) {
  return `dev:${userId}:${deviceId}:${sessionId}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function connectClient(name, user) {
  const socket = io(socketUrl, {
    auth: {
      accessToken: createDevToken(user),
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

function waitForEvent(socket, eventName, durationMs = 4000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timeout waiting ${eventName}`)),
      durationMs,
    );

    socket.once(eventName, (event) => {
      clearTimeout(timeout);
      resolve(event);
    });
  });
}

async function emitWithSystemResult(socket, eventName, payload) {
  const resultPromise = waitForSystemEvent(socket, payload.requestId);
  socket.emit(eventName, payload);
  return resultPromise;
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
  console.log(`[RT-28] Testing reconnect during call against ${socketUrl}`);

  const socketA = await connectClient("A", users.a);
  let socketB = await connectClient("B-before-reconnect", users.b);

  try {
    await joinConversation(socketA);
    await joinConversation(socketB);

    const callId = createUuidV7();
    const incomingPromise = waitForEvent(socketB, "call:incoming");
    const startResult = await emitWithSystemResult(socketA, "call:start", {
      requestId: createUuidV7(),
      timestamp: new Date().toISOString(),
      payload: {
        callId,
        conversationId,
        callType: "voice",
        calleeUserId: users.b.userId,
      },
    });
    const incoming = await incomingPromise;

    assertCondition(startResult.kind === "ack", "call:start must ack");
    assertCondition(incoming.callId === callId, "B must receive call:incoming");
    console.log("[RT-28] B received call:incoming");

    const acceptResult = await emitWithSystemResult(socketB, "call:accept", {
      requestId: createUuidV7(),
      timestamp: new Date().toISOString(),
      payload: {
        callId,
        conversationId,
      },
    });

    assertCondition(acceptResult.kind === "ack", "call:accept must ack");
    console.log("[RT-28] B accepted call");

    socketB.disconnect();
    await sleep(300);

    socketB = await connectClient("B-after-reconnect", users.b);
    // Room restored from memory without calling conversation:join again.
    await sleep(500);

    const offerPromise = waitForEvent(socketB, "call:offer");
    const offerResult = await emitWithSystemResult(socketA, "call:offer", {
      requestId: createUuidV7(),
      timestamp: new Date().toISOString(),
      payload: {
        callId,
        conversationId,
        sdp: "v=0\r\ns=rt28-test-offer\r\n",
        sdpType: "offer",
      },
    });
    const offer = await offerPromise;

    assertCondition(offerResult.kind === "ack", "call:offer must ack");
    assertCondition(offer.callId === callId, "reconnected B must receive call:offer");
    console.log("[RT-28] Reconnected B received call:offer without joining again");

    console.log("[RT-28] PASS");
  } finally {
    socketA.disconnect();
    socketB.disconnect();
  }
}

main().catch((error) => {
  console.error("[RT-28] FAIL");
  console.error(error);
  process.exitCode = 1;
});
