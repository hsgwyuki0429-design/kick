export class Hud {
  constructor() {
    this.el = {
      youFill: document.getElementById("youHpFill"),
      oppFill: document.getElementById("oppHpFill"),
      youKnockdowns: document.getElementById("youKnockdowns"),
      oppKnockdowns: document.getElementById("oppKnockdowns"),
      status: document.getElementById("statusMsg"),
      block: document.getElementById("blockIndicator"),
      menu: document.getElementById("menu"),
      result: document.getElementById("resultOverlay"),
      resultTitle: document.getElementById("resultTitle"),
      resultSub: document.getElementById("resultSub"),
      countdown: document.getElementById("countdown"),
      netStatus: document.getElementById("netStatus"),
    };
  }

  setHp(youHp, oppHp) {
    this.el.youFill.style.width = `${Math.max(0, youHp)}%`;
    this.el.oppFill.style.width = `${Math.max(0, oppHp)}%`;
  }

  setKnockdowns(youKd, oppKd) {
    this.el.youKnockdowns.textContent = "●".repeat(Math.min(youKd, 5));
    this.el.oppKnockdowns.textContent = "●".repeat(Math.min(oppKd, 5));
  }

  setStatus(msg, timeoutMs = 0) {
    this.el.status.textContent = msg || "";
    if (timeoutMs > 0) {
      clearTimeout(this._statusTimer);
      this._statusTimer = setTimeout(() => { this.el.status.textContent = ""; }, timeoutMs);
    }
  }

  setBlocking(active) {
    this.el.block.classList.toggle("active", !!active);
  }

  showMenu(show) {
    this.el.menu.classList.toggle("hidden", !show);
  }

  showResult(show, { title = "", sub = "" } = {}) {
    this.el.result.classList.toggle("hidden", !show);
    if (show) {
      this.el.resultTitle.textContent = title;
      this.el.resultSub.textContent = sub;
    }
  }

  showCountdown(text) {
    if (text === null) {
      this.el.countdown.classList.add("hidden");
      return;
    }
    this.el.countdown.classList.remove("hidden");
    this.el.countdown.textContent = text;
  }

  setNetStatus(msg) {
    this.el.netStatus.textContent = msg || "";
  }
}
