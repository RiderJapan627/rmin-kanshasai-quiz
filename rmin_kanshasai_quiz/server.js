const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const HOST_PIN = process.env.HOST_PIN || "change-this-pin";

app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_req, res) => res.json({ ok: true }));

const roomCode = (crypto.randomBytes(3).toString("hex")).toUpperCase();
const players = new Map();
const state = {
  roomCode,
  phase: "lobby", // lobby | question | locked | reveal
  question: null,
  questionNumber: 0,
  timeLimit: 20,
  secondsLeft: 20,
  deadline: null,
  answers: {},
  firstBuzz: null,
  leaderboard: [],
  hostConnected: false
};

const demoQuestions = [
  { text: "サンプル問題：日本の首都はどこ？", choices: ["大阪", "東京", "京都", "福岡"], correct: 1, points: 10 },
  { text: "サンプル問題：1年は通常何か月？", choices: ["10か月", "11か月", "12か月", "13か月"], correct: 2, points: 10 },
  { text: "サンプル問題：水の化学式は？", choices: ["CO₂", "O₂", "NaCl", "H₂O"], correct: 3, points: 10 }
];

function publicState() {
  const answerCounts = Object.values(state.answers).reduce((acc, a) => {
    if (a && Number.isInteger(a.choice)) acc[a.choice] = (acc[a.choice] || 0) + 1;
    return acc;
  }, {});
  return {
    roomCode: state.roomCode,
    phase: state.phase,
    question: state.question ? {
      text: state.question.text,
      choices: state.question.choices,
      points: state.question.points || 10
    } : null,
    questionNumber: state.questionNumber,
    timeLimit: state.timeLimit,
    secondsLeft: state.secondsLeft,
    deadline: state.deadline,
    players: [...players.values()].map(p => ({ id: p.id, name: p.name, score: p.score, connected: p.connected, buzzed: p.buzzed })),
    leaderboard: [...players.values()].map(p => ({ id: p.id, name: p.name, score: p.score })).sort((a,b) => b.score-a.score),
    answerCounts,
    firstBuzz: state.firstBuzz,
    answers: state.phase === "reveal" ? Object.fromEntries(Object.entries(state.answers).map(([id,a]) => [id, { choice: a.choice, correct: a.correct }])) : {}
  };
}
function broadcast() { io.emit("state", publicState()); }

io.on("connection", socket => {
  socket.emit("state", publicState());

  socket.on("join", payload => {
    const name = String(payload?.name || "").trim().slice(0, 16);
    const code = String(payload?.roomCode || "").trim().toUpperCase();
    if (code !== state.roomCode) return socket.emit("notice", { type: "error", text: "ルームコードが違います。" });
    if (!name) return socket.emit("notice", { type: "error", text: "名前を入力してください。" });
    const existing = [...players.values()].find(p => p.name.toLowerCase() === name.toLowerCase());
    if (existing && existing.socketId !== socket.id) {
      existing.socketId = socket.id;
      existing.connected = true;
      existing.buzzed = false;
      socket.data.playerId = existing.id;
    } else {
      if (players.size >= 10) return socket.emit("notice", { type: "error", text: "参加人数は最大10人です。" });
      const id = crypto.randomUUID();
      players.set(id, { id, name, score: 0, connected: true, buzzed: false, socketId: socket.id });
      socket.data.playerId = id;
    }
    socket.emit("joined", { id: socket.data.playerId, roomCode: state.roomCode });
    broadcast();
  });

  socket.on("host-auth", pin => {
    if (String(pin || "") !== HOST_PIN) return socket.emit("notice", { type: "error", text: "司会者PINが違います。" });
    socket.data.isHost = true;
    state.hostConnected = true;
    socket.emit("host-auth-ok", { roomCode: state.roomCode });
    socket.emit("host-state", { demoQuestions });
    broadcast();
  });

  socket.on("start-question", payload => {
    if (!socket.data.isHost) return;
    const q = {
      text: String(payload?.text || "").trim().slice(0, 500),
      choices: Array.isArray(payload?.choices) ? payload.choices.slice(0,4).map(x => String(x).slice(0,160)) : [],
      correct: Number(payload?.correct),
      points: Math.max(1, Math.min(1000, Number(payload?.points) || 10))
    };
    const seconds = Math.max(5, Math.min(120, Number(payload?.seconds) || 20));
    if (!q.text || q.choices.length !== 4 || q.choices.some(x => !x.trim()) || !Number.isInteger(q.correct) || q.correct < 0 || q.correct > 3) {
      return socket.emit("notice", { type: "error", text: "問題文・4つの選択肢・正解を確認してください。" });
    }
    state.question = q;
    state.questionNumber += 1;
    state.timeLimit = seconds;
    state.secondsLeft = seconds;
    state.deadline = Date.now() + seconds * 1000;
    state.phase = "question";
    state.answers = {};
    state.firstBuzz = null;
    for (const p of players.values()) p.buzzed = false;
    broadcast();
    clearInterval(timer);
    timer = setInterval(() => {
      state.secondsLeft = Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000));
      if (state.secondsLeft <= 0) {
        clearInterval(timer);
        state.phase = "locked";
      }
      broadcast();
    }, 250);
  });

  socket.on("buzz", () => {
    const p = players.get(socket.data.playerId);
    if (!p || state.phase !== "question" || p.buzzed) return;
    p.buzzed = true;
    if (!state.firstBuzz) state.firstBuzz = { id: p.id, name: p.name, at: Date.now() };
    broadcast();
  });

  socket.on("answer", choice => {
    const p = players.get(socket.data.playerId);
    const index = Number(choice);
    if (!p || state.phase !== "question" || !Number.isInteger(index) || index < 0 || index > 3 || state.answers[p.id]) return;
    state.answers[p.id] = { choice: index, correct: index === state.question.correct, at: Date.now() };
    socket.emit("answer-received", { ok: true });
    broadcast();
  });

  socket.on("lock-answers", () => {
    if (!socket.data.isHost) return;
    clearInterval(timer);
    state.phase = "locked";
    state.secondsLeft = 0;
    broadcast();
  });

  socket.on("reveal", () => {
    if (!socket.data.isHost || !state.question) return;
    for (const [id, a] of Object.entries(state.answers)) {
      a.correct = a.choice === state.question.correct;
      if (a.correct) players.get(id).score += state.question.points;
    }
    state.phase = "reveal";
    broadcast();
  });

  socket.on("back-to-lobby", () => {
    if (!socket.data.isHost) return;
    clearInterval(timer);
    state.phase = "lobby";
    state.question = null;
    state.answers = {};
    state.secondsLeft = state.timeLimit;
    state.firstBuzz = null;
    broadcast();
  });

  socket.on("reset-scores", () => {
    if (!socket.data.isHost) return;
    for (const p of players.values()) p.score = 0;
    broadcast();
  });

  socket.on("disconnect", () => {
    const p = players.get(socket.data.playerId);
    if (p) p.connected = false;
    if (socket.data.isHost) state.hostConnected = false;
    broadcast();
  });
});

let timer = null;
server.listen(PORT, "0.0.0.0", () => console.log(`R民感謝祭 quiz server listening on ${PORT}`));
