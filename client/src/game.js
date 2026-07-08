import { GameScene } from "./scene.js";
import { InputController } from "./input.js";
import { Hud } from "./hud.js";
import { CpuOpponent } from "./ai.js";
import { NetClient } from "./netClient.js";
import { createMatchState, applyDamage, computeDamage } from "../../shared/matchLogic.js";

export class Game {
  constructor() {
    this.canvas = document.getElementById("scene");
    this.scene = new GameScene(this.canvas);
    this.hud = new Hud();
    this.mode = null; // 'offline' | 'online'
    this.over = false;

    this.input = new InputController(this.canvas, {
      onPunch: (hand, type, power) => this._onLocalPunch(hand, type, power),
      onBlockChange: (active) => this._onLocalBlockChange(active),
    });

    this._wireMenu();
    this._loop();
  }

  _wireMenu() {
    document.getElementById("btnOffline").onclick = () => this.startOffline();
    document.getElementById("btnQuickMatch").onclick = () => this.startOnline(null);
    document.getElementById("btnJoinRoom").onclick = () => {
      const code = document.getElementById("roomCodeInput").value.trim().toUpperCase();
      this.startOnline(code || null);
    };
    document.getElementById("btnRematch").onclick = () => this._rematch();
    document.getElementById("btnBackToMenu").onclick = () => this._backToMenu();
  }

  // ---------------------------------------------------------------- OFFLINE

  startOffline() {
    this._teardownMode();
    this.mode = "offline";
    this.you = createMatchState();
    this.opp = createMatchState();
    this.over = false;
    this.hud.showMenu(false);
    this.hud.showResult(false);
    this.scene.resetPoses();
    this._syncHud();

    this.ai = new CpuOpponent({
      onTelegraph: () => {},
      onPunch: (hand, type, power) => this._onCpuPunch(hand, type, power),
      onBlockChange: (active) => this.scene.opponentBlock(active),
      getOwnHp: () => this.opp.hp,
    });

    this._runCountdown(() => this.ai.start());
  }

  _onLocalPunch(hand, type, power) {
    if (this.over || !this.roundActive) return;
    this.scene.playerPunch(hand, type);
    if (this.mode === "offline") {
      const dmg = computeDamage(type, power);
      const result = applyDamage(this.opp, dmg, this._aiIsBlocking());
      this._applyResultToOpponent(result);
    } else if (this.mode === "online") {
      this.net.sendPunch(hand, type, power);
    }
  }

  _aiIsBlocking() {
    return !!this.ai?.blocking;
  }

  _onCpuPunch(hand, type, power) {
    if (this.over) return;
    this.scene.opponentPunch(hand, type);
    const dmg = computeDamage(type, power);
    const result = applyDamage(this.you, dmg, this.input.blocking);
    this._applyResultToPlayer(result);
  }

  _onLocalBlockChange(active) {
    this.hud.setBlocking(active);
    if (this.mode === "online") this.net.sendBlock(active);
  }

  // ----------------------------------------------------------------- ONLINE

  async startOnline(roomCode) {
    this._teardownMode();
    this.mode = "online";
    this.you = createMatchState();
    this.opp = createMatchState();
    this.over = false;
    this.hud.showMenu(false);
    this.hud.showResult(false);
    this.scene.resetPoses();
    this._syncHud();
    this.hud.setStatus(roomCode ? `合言葉「${roomCode}」で対戦相手を探しています…` : "対戦相手を探しています…");

    this.net = new NetClient({
      onMessage: (msg) => this._onNetMessage(msg),
      onClose: () => {
        if (this.mode === "online" && !this.over) {
          this.hud.setStatus("サーバーとの接続が切れました", 4000);
          this._backToMenu();
        }
      },
    });

    try {
      const joined = await this.net.connect(roomCode);
      this.myRoomCode = joined.roomCode;
    } catch (err) {
      this.hud.setStatus(`接続できませんでした: ${err.message}`, 5000);
      this.hud.showMenu(true);
      this.mode = null;
    }
  }

  _onNetMessage(msg) {
    switch (msg.type) {
      case "waiting":
        this.hud.setStatus(`対戦相手を待っています… 合言葉「${this.myRoomCode}」`);
        break;
      case "start":
        this.hud.setStatus("");
        this.you = createMatchState();
        this.opp = createMatchState();
        this._syncHud();
        this._runCountdown(() => {});
        break;
      case "opponentBlock":
        this.scene.opponentBlock(msg.active);
        break;
      case "hit": {
        if (msg.target === "opp") {
          // our punch landed on them
          this.scene.opponentHitReaction(msg.blocked ? 0.4 : 1);
        } else {
          // their punch landed on us
          this.scene.opponentPunch(msg.hand, msg.punchType);
          this.scene.playerHitReaction(msg.blocked ? 0.4 : 1);
        }
        break;
      }
      case "state":
        this.you.hp = msg.you.hp;
        this.you.knockdowns = msg.you.knockdowns;
        this.opp.hp = msg.opp.hp;
        this.opp.knockdowns = msg.opp.knockdowns;
        this._syncHud();
        break;
      case "ko":
        this.over = true;
        if (msg.winner === "you") {
          this.scene.opponentKO();
          this._endMatch(true);
        } else {
          this._endMatch(false);
        }
        break;
      case "opponentLeft":
        if (!this.over) {
          this.hud.setStatus("相手が退出しました", 3000);
          this._endMatch(true, true);
        }
        break;
    }
  }

  // ----------------------------------------------------------------- SHARED

  _applyResultToOpponent(result) {
    this.scene.opponentHitReaction(result.blocked ? 0.4 : 1);
    this._syncHud();
    if (result.knockedDown && !result.ko) this.hud.setStatus("相手ダウン！ そして立ち上がった…", 1600);
    if (result.ko) { this.scene.opponentKO(); this._endMatch(true); }
  }

  _applyResultToPlayer(result) {
    this.scene.playerHitReaction(result.blocked ? 0.4 : 1);
    this._syncHud();
    if (result.knockedDown && !result.ko) this.hud.setStatus("ダウン！ なんとか立ち上がった…", 1600);
    if (result.ko) this._endMatch(false);
  }

  _syncHud() {
    this.hud.setHp(this.you.hp, this.opp.hp);
    this.hud.setKnockdowns(this.you.knockdowns, this.opp.knockdowns);
  }

  _endMatch(playerWon, opponentLeft = false) {
    this.over = true;
    this.ai?.stop();
    if (playerWon) {
      this.hud.showResult(true, { title: "YOU WIN!", sub: opponentLeft ? "相手が退出しました" : "相手をKOしました" });
    } else {
      this.hud.showResult(true, { title: "KO...", sub: "あなたはノックアウトされました" });
    }
  }

  _rematch() {
    if (this.mode === "offline") {
      this.startOffline();
    } else if (this.mode === "online") {
      this.hud.showResult(false);
      this.hud.setStatus("相手の準備を待っています…");
      this.net?.sendReady();
    }
  }

  _backToMenu() {
    this._teardownMode();
    this.hud.showResult(false);
    this.hud.setStatus("");
    this.hud.showMenu(true);
  }

  _teardownMode() {
    this.ai?.stop();
    this.ai = null;
    this.net?.close();
    this.net = null;
    this.mode = null;
    this.over = true;
    this.input.blocking = false;
    this.hud.setBlocking(false);
  }

  _runCountdown(onDone) {
    this.roundActive = false;
    const steps = ["3", "2", "1", "FIGHT!"];
    let i = 0;
    const next = () => {
      if (i >= steps.length) {
        this.hud.showCountdown(null);
        this.roundActive = true;
        onDone();
        return;
      }
      this.hud.showCountdown(steps[i]);
      i++;
      setTimeout(next, i === steps.length ? 500 : 650);
    };
    next();
  }

  _loop = () => {
    this.scene.update();
    requestAnimationFrame(this._loop);
  };
}
