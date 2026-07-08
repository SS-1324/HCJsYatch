"use strict";

// 0. 기본 규칙 및 상태 변수
const CATEGORY_KEYS = ["aces", "deuces", "threes", "fours", "fives", "sixes", "choice", "fourKind", "fullHouse", "smallStraight", "largeStraight", "yacht"];
const CATEGORY_NAMES = ["에이스", "듀스", "트리플", "포카드", "파이브", "식스", "초이스", "포카인드", "풀하우스", "스몰 스트레이트", "라지 스트레이트", "요트"];
const N_CAT = 12;
const IS_UPPER = [true, true, true, true, true, true, false, false, false, false, false, false];
const UPPER_CAP = 63, BONUS = 35; 

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const TIMING = { ROLL_DISPLAY: 800, THINK: 300, SELECT_STEP: 400, TO_REROLL: 400, TURN_SWITCH: 600 };
const el = (sel) => document.querySelector(sel);

function newPlayerState() { return { upper: 0, scores: new Array(N_CAT).fill(null) }; }

const game = {
  round: 1, turn: "human", mode: "bot", playerName: "Player",
  human: newPlayerState(), bot: newPlayerState(),
  dice: [1, 1, 1, 1, 1], held: [false, false, false, false, false],
  rollsUsed: 0, gameOver: false, busy: false,
};

// scores 배열로부터 필요할 때마다 계산하는 비트마스크
function usedMask(p) {
  let m = 0;
  p.scores.forEach((s, i) => { if (s !== null) m |= (1 << i); });
  return m;
}

// 1. 로컬 스토리지
const Storage = {
  get() {
    const data = localStorage.getItem("yacht_data");
    return data ? JSON.parse(data) : { highScores: [], wins: 0, losses: 0 };
  },
  save(data) {
    localStorage.setItem("yacht_data", JSON.stringify(data));
  }
};

function updateHomeStats() {
  const data = Storage.get();
  const topScore = data.highScores.length > 0 ? data.highScores[0] : 0;
  el("#preview-single").textContent = `최고 점수: ${topScore}점`;
  el("#preview-bot").textContent = `전적: ${data.wins}승 ${data.losses}패`;
}

function renderRanking() {
  const data = Storage.get();
  const container = el(".ranking-content");
  if (data.highScores.length === 0) {
    container.innerHTML = "랭킹 데이터가 없습니다.<br>첫 게임을 플레이해보세요!";
    return;
  }
  container.innerHTML = data.highScores.map((score, i) => 
    `<div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--line);">
      <span>${i + 1}위</span> <span style="color:var(--gold-bright); font-weight:bold;">${score}점</span>
    </div>`
  ).join("");
}

// 2. 점수 계산 유틸리티
function rollDie() { return 1 + Math.floor(Math.random() * 6); }
function countsOf(diceArr) {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const v of diceArr) c[v]++;
  return c;
}

function categoryScore(cat, counts, sum) {
  if (cat < 6) return counts[cat + 1] * (cat + 1);
  if (cat === 6) return sum; 
  if (cat === 7) return counts.some(c => c >= 4) ? sum : 0;
  if (cat === 8) {
    const has3 = counts.includes(3), has2 = counts.includes(2), has5 = counts.includes(5);
    return (has3 && has2) || has5 ? sum : 0;
  }
  if (cat === 9) {
    const p = counts.map(c => c > 0);
    return (p[1]&&p[2]&&p[3]&&p[4]) || (p[2]&&p[3]&&p[4]&&p[5]) || (p[3]&&p[4]&&p[5]&&p[6]) ? 15 : 0;
  }
  if (cat === 10) {
    const p = counts.map(c => c > 0);
    return (p[1]&&p[2]&&p[3]&&p[4]&&p[5]) || (p[2]&&p[3]&&p[4]&&p[5]&&p[6]) ? 30 : 0;
  }
  if (cat === 11) return counts.includes(5) ? 50 : 0;
  return 0;
}

function totalScore(p) {
  const upper = p.scores.slice(0, 6).reduce((a, b) => a + (b || 0), 0);
  const lower = p.scores.slice(6).reduce((a, b) => a + (b || 0), 0);
  const bonus = upper >= UPPER_CAP ? BONUS : 0;
  return { upper, bonus, lower, total: upper + bonus + lower };
}

// 3. 뷰 렌더링 통합 
function renderDice() {
  const container = el("#dice-area");
  container.innerHTML = "";
  const canToggle = game.turn === "human" && !game.busy && game.rollsUsed > 0 && game.rollsUsed < 3;
  const layoutMap = { 1:[5], 2:[1,9], 3:[1,5,9], 4:[1,3,7,9], 5:[1,3,5,7,9], 6:[1,3,4,6,7,9] };
  
  game.dice.forEach((val, i) => {
    const die = document.createElement("div");
    die.className = `die ${game.held[i] ? "die--held" : ""} ${canToggle ? "die--clickable" : ""}`;
    for (let p = 1; p <= 9; p++) {
      const dot = document.createElement("span");
      dot.className = "pip";
      dot.style.gridArea = `p${p}`;
      dot.style.visibility = layoutMap[val].includes(p) ? "visible" : "hidden";
      die.appendChild(dot);
    }
    if (canToggle) die.addEventListener("click", () => { game.held[i] = !game.held[i]; renderDice(); });
    container.appendChild(die);
  });
}

function renderScoreboard(playerKey, panelSel) {
  const p = game[playerKey];
  const panel = el(panelSel);
  const counts = countsOf(game.dice), sum = game.dice.reduce((a, b) => a + b, 0);
  const canPick = playerKey === "human" && game.turn === "human" && !game.busy && game.rollsUsed > 0;

  panel.querySelectorAll("[data-cat]").forEach(tr => {
    const c = parseInt(tr.dataset.cat, 10);
    const scoreTd = tr.querySelector(".score-cell");
    const used = p.scores[c] !== null;

    tr.className = ""; scoreTd.className = "score-cell";
    if (used) {
      scoreTd.textContent = p.scores[c];
      tr.classList.add("used");
    } else if (canPick) {
      scoreTd.textContent = categoryScore(c, counts, sum);
      scoreTd.classList.add("preview");
      tr.classList.add("selectable");
    } else {
      scoreTd.textContent = "-";
      scoreTd.classList.add("empty");
    }
  });

  const t = totalScore(p);
  const upperSumEl = panel.querySelector(".upper-sum");
  const bonusStatusEl = panel.querySelector(".bonus-status");
  const bonusRowEl = panel.querySelector(".bonus-row");

  // 상단 누적 점수 텍스트 갱신
  upperSumEl.textContent = `${t.upper} / ${UPPER_CAP}`;

  if (bonusStatusEl && bonusRowEl) {
    if (t.upper >= UPPER_CAP) {
      bonusStatusEl.textContent = "(O)";
      bonusRowEl.style.fontWeight = "700";
    } else {
      bonusStatusEl.textContent = "(X)";
      bonusRowEl.style.fontWeight = "";
    }
  }

  panel.querySelector(".total-val").textContent = t.total;
}

function renderUI() {
  renderDice();
  renderScoreboard("human", "#panel-human");
  if (game.mode === "bot") renderScoreboard("bot", "#panel-bot");
  
  el("#round-line").textContent = `라운드 ${Math.min(game.round, N_CAT)} / ${N_CAT}`;
  el("#panel-human").classList.toggle("active-turn", game.turn === "human" && !game.gameOver);
  el("#panel-bot").classList.toggle("active-turn", game.turn === "bot" && !game.gameOver);

  const btn = el("#roll-btn");
  if (game.gameOver) {
    btn.disabled = false;
    btn.textContent = "게임 재시작";
  } else if (game.turn !== "human" || game.busy) {
    btn.disabled = true;
    btn.textContent = "진행 중...";
  } else if (game.rollsUsed >= 3) {
    btn.disabled = true; 
    btn.textContent = "족보를 선택하세요";
  } else {
    btn.disabled = false;
    btn.textContent = game.rollsUsed === 0 ? "주사위 굴리기 (1/3)" : `다시 굴리기 (${game.rollsUsed + 1}/3)`;
  }
}

async function animateDiceRoll(keepPos, finalDice) {
  game.busy = true; renderUI();
  for (let i = 0; i < 10; i++) {
    game.dice = game.dice.map((v, idx) => keepPos[idx] ? v : rollDie());
    renderDice();
    await sleep(80);
  }
  game.dice = finalDice.slice();
  game.busy = false; renderUI();
}

// 플레이어 & 봇 턴 로직
async function humanRoll() {
  if (game.gameOver) {
    startGame(game.mode);
    return;
  }

  if (game.turn !== "human" || game.busy || game.rollsUsed >= 3) return;
  if (game.rollsUsed === 0) game.held = [false, false, false, false, false];

  const finalDice = game.dice.map((v, i) => game.held[i] ? v : rollDie());
  game.rollsUsed++;
  await animateDiceRoll(game.held, finalDice);
}

function humanPickCategory(cat) {
  const p = game.human;
  if (p.scores[cat] !== null) return;
  
  const sc = categoryScore(cat, countsOf(game.dice), game.dice.reduce((a,b)=>a+b,0));
  p.scores[cat] = sc;

  if (IS_UPPER[cat]) p.upper = Math.min(UPPER_CAP, p.upper + sc);
  endHumanTurn();
}

async function endHumanTurn() {
  game.busy = true; renderUI();
  await sleep(TIMING.TURN_SWITCH);
  
  if (game.mode === "single") {
    finishRoundAndSwitch();
  } else {
    game.turn = "bot"; game.dice = [1, 1, 1, 1, 1]; game.rollsUsed = 0; game.busy = false;
    renderUI();
    await botTurn();
  }
}

async function botTurn() {
  game.busy = true; renderUI();
  const { g0, g1 } = computeValueVectors(usedMask(game.bot), game.bot.upper);

  let dice = [rollDie(), rollDie(), rollDie(), rollDie(), rollDie()];
  game.held = [false, false, false, false, false];
  
  await animateDiceRoll(game.held, dice);
  await sleep(TIMING.THINK); // 1차 굴림 후 고민

  let keep = decideKeep(dice, g1);
  dice = await botApplyKeepAndReroll(dice, keep);

  if (keep.length < 5) {
    await sleep(TIMING.THINK); // 2차 리롤 전 고민
    keep = decideKeep(dice, g0);
    dice = await botApplyKeepAndReroll(dice, keep);
  }

  await sleep(TIMING.THINK); // 최종 족보 선택 전 고민
  const decision = decideCategory(dice, game.bot.used, game.bot.upper);
  game.bot.scores[decision.cat] = decision.score;
  if (IS_UPPER[decision.cat]) game.bot.upper = decision.newUpper;
  
  renderUI();
  await sleep(TIMING.TURN_SWITCH);
  finishRoundAndSwitch();
}

async function botApplyKeepAndReroll(dice, keepMultiset) {
  const keepPos = positionsToKeep(dice, keepMultiset);
  for (let i = 0; i < 5; i++) {
    if (keepPos[i] !== game.held[i]) {
      game.held[i] = keepPos[i]; renderDice(); await sleep(TIMING.SELECT_STEP);
    }
  }
  if (keepMultiset.length === 5) return dice;

  await sleep(TIMING.TO_REROLL);
  const newDice = dice.map((v, i) => (keepPos[i] ? v : rollDie()));
  await animateDiceRoll(game.held, newDice);
  return newDice;
}

// 게임 종료 및 기록 저장
function finishRoundAndSwitch() {
  if (game.mode === "single" || game.turn === "bot") game.round++;
  
  if (game.round > N_CAT) {
    endGame(); return;
  }
  game.turn = "human"; game.dice = [1, 1, 1, 1, 1]; game.held = [false, false, false, false, false];
  game.rollsUsed = 0; game.busy = false;
  renderUI();
}

function endGame() {
  game.gameOver = true; game.busy = true;
  const h = totalScore(game.human), b = totalScore(game.bot);
  const data = Storage.get();
  let msg;

  if (game.mode === "single") {
    msg = `게임 종료! 최종 점수: ${h.total}점`;
    data.highScores.push(h.total);
    data.highScores.sort((x, y) => y - x); 
    data.highScores = data.highScores.slice(0, 10); 
    Storage.save(data);
    renderRanking(); 
  } else {
    if (h.total > b.total) { msg = `당신의 승리! (${h.total} : ${b.total})`; data.wins++; }
    else if (h.total < b.total) { msg = `AI의 승리! (${b.total} : ${h.total})`; data.losses++; }
    else { msg = `무승부! (${h.total} : ${b.total})`; }
    Storage.save(data);
  }
  
  updateHomeStats(); 
  
  renderUI();
  el("#game-over-banner").textContent = msg;
  el("#game-over-banner").classList.remove("hidden");
}

// 6. 라우팅(화면 전환) 및 초기화

function navigateToView(viewId, pushState = true) {
  document.querySelectorAll(".view-section").forEach(e => e.classList.add("hidden"));
  document.getElementById(viewId).classList.remove("hidden");
  
  // 브라우저 히스토리에 기록을 남김
  if (pushState) {
    history.pushState({ viewId: viewId }, "", "");
  }
}

function showNameError(msg) {
  const errEl = el("#name-error");
  const inputEl = el("#player-name-input");
  errEl.textContent = msg;
  errEl.classList.remove("hidden");
  requestAnimationFrame(() => errEl.classList.add("show"));
  inputEl.classList.add("input-invalid");
}

function clearNameError() {
  const errEl = el("#name-error");
  errEl.classList.remove("show");
  el("#player-name-input").classList.remove("input-invalid");
}

function startGame(selectedMode) {
  const inputName = el("#player-name-input").value.trim();
  const nameRegex = /^[가-힣a-zA-Z0-9]{1,6}$/;

  clearNameError(); // 이전 에러 메시지 초기화

  if (inputName === "") {
    game.playerName = "Player";
  } else if (!nameRegex.test(inputName)) {
    showNameError("이름은 띄어쓰기 및 특수문자 없이 한글, 영문, 숫자 1~6자로 입력해주세요!");
    return;
  } else {
    game.playerName = inputName;
  }

  game.mode = selectedMode;
  el("#display-player-name").textContent = game.playerName;

  if (selectedMode === "single") {
    el("#game-mode-title").textContent = "SINGLE YACHT";
    el("#panel-bot").classList.add("hidden");
    el("#panel-ranking").classList.remove("hidden");
    renderRanking();
  } else {
    el("#game-mode-title").textContent = `${game.playerName.toUpperCase()} vs. BOT`;
    el("#panel-bot").classList.remove("hidden");
    el("#panel-ranking").classList.add("hidden");
  }

  game.round = 1; game.turn = "human"; game.gameOver = false; game.busy = false;
  game.human = newPlayerState(); game.bot = newPlayerState();
  game.dice = [1, 1, 1, 1, 1]; game.held = [false, false, false, false, false]; game.rollsUsed = 0;

  el("#game-over-banner").classList.add("hidden");
  renderUI();
  navigateToView("view-game");
}

window.addEventListener("DOMContentLoaded", () => {
  setupAIEngine();
  updateHomeStats(); 
  
  el("#btn-mode-single").addEventListener("click", () => startGame("single"));
  el("#btn-mode-bot").addEventListener("click", () => startGame("bot"));
  el("#btn-home").addEventListener("click", () => navigateToView("view-home"));
  el("#btn-restart").addEventListener("click", () => startGame(game.mode));
  el("#roll-btn").addEventListener("click", humanRoll);
  
  const toggleRules = () => el("#modal-rules").classList.toggle("hidden");
  ["#btn-rules-home", "#btn-rules-game", "#btn-close-rules"].forEach(id => 
    el(id)?.addEventListener("click", toggleRules)
  );

  el("#panel-human").addEventListener("click", (e) => {
    const tr = e.target.closest(".selectable[data-cat]");
    if (tr && !game.busy) humanPickCategory(parseInt(tr.dataset.cat, 10));
  });

  // 최초 진입 상태 기억
  history.replaceState({ viewId: "view-home" }, "", "");
  navigateToView("view-home", false);
});

// 뒤로가기 지원
window.addEventListener("popstate", (e) => {
  if (e.state && e.state.viewId) {
    navigateToView(e.state.viewId, false); // 히스토리 추가 생성 없이 화면만 토글
  }
});