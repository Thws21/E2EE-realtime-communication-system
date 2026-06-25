// Minimal frontend behavior for the static demo
const root = document.getElementById("root");
root.innerHTML = `
  <div class="app">
    <div class="header">
      <div class="brand">E2EE RTC Demo</div>
      <div class="subtitle">Lightweight frontend extracted from index</div>
    </div>
    <div class="controls">
      <button id="connectBtn">Connect</button>
      <button id="clearBtn" class="secondary">Clear</button>
    </div>
    <div class="messages" id="messages"></div>
    <div class="footer">
      <input id="input" class="input" placeholder="Type a message..." />
      <button id="sendBtn">Send</button>
    </div>
  </div>
`;

const messages = document.getElementById("messages");
const input = document.getElementById("input");
const sendBtn = document.getElementById("sendBtn");
const connectBtn = document.getElementById("connectBtn");
const clearBtn = document.getElementById("clearBtn");

function addMsg(text) {
  const d = document.createElement("div");
  d.className = "msg";
  d.textContent = text;
  messages.appendChild(d);
  messages.scrollTop = messages.scrollHeight;
}

sendBtn.addEventListener("click", () => {
  const v = input.value.trim();
  if (!v) return;
  addMsg("You: " + v);
  input.value = "";
});

input.addEventListener("keypress", (e) => {
  if (e.key === "Enter") sendBtn.click();
});

connectBtn.addEventListener("click", () => {
  addMsg("System: connected (demo)");
});

clearBtn.addEventListener("click", () => {
  messages.innerHTML = "";
});
