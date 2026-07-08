// game.js
// 화면 렌더링, 사용자 입력, 턴 진행 등 게임 전반의 흐름을 담당(메인 스크립트)

"use strict";

import { CATEGORY_NAMES, N_CAT, IS_UPPER, UPPER_CAP, BONUS, rollDie, countsOf, categoryScore } from './rules.js';
import { setupAIEngine, computeValueVectors, decideKeep, decideCategory, positionsToKeep } from './ai_engine.js';

// 공통 유틸, 타이밍 설정
// BOT 턴의 결과 대기(0.7초), 선택-선택간 딜레이(0.4초) 등을 설정.
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const TIMING = { ROLL_DISPLAY: 800, THINK: 700, SELECT_STEP: 400, TO_REROLL: 400, TURN_SWITCH: 600 };
// querySelector 축약 헬퍼
const el = (sel) => document.querySelector(sel);

// 사람/봇의 초기 상태를 생성. upper는 에이스~식스까지의 점수.(보너스를 위해 따로 한번 더 관리)
// score는 12개 족보 각각의 점수. null = 아직 선택되지 않음.
function newPlayerState() { return { upper: 0, scores: new Array(N_CAT).fill(null) }; }

// CATEGORY_NAMES를 바탕으로 점수판 HTML을 생성.
function buildBoardHTML() {
  const upperRows = CATEGORY_NAMES.slice(0, 6).map((name, i) =>
    `<tr data-cat="${i}"><td>${name}</td><td class="score-cell">-</td></tr>`
  ).join("");

  const lowerRows = CATEGORY_NAMES.slice(6).map((name, i) =>
    `<tr data-cat="${i + 6}"><td>${name}</td><td class="score-cell">-</td></tr>`
  ).join("");

  return `
    <table class="table-upper"><tbody>
      ${upperRows}
      <tr class="summary-row bonus-row">
        <td>+35</td>
        <td class="score-cell">
          <span class="upper-sum">0 / ${UPPER_CAP}</span>
          <span class="bonus-status" style="margin-left:10px;">(X)</span>
        </td>
      </tr>
    </tbody></table>
    <table class="table-lower"><tbody>
      ${lowerRows}
      <tr class="summary-row total-row"><td>총점</td><td class="score-cell total-val">0</td></tr>
    </tbody></table>
  `;
}

// 페이지를 로드할 때 human/bot 보드(data-board 컨테이너)에 buildBoardHTML()을 넣어 초기화.
function initBoards() {
  document.querySelectorAll("[data-board]").forEach(container => {
    container.innerHTML = buildBoardHTML();
  });
}

// 게임 전역 상태. 게임이 현재 어떤 상태인지 표시.
const game = {
  round: 1, // 현재 라운드 (1~12)
  turn: "human", // 현재 누구의 턴인지(human/bot)
  mode: "bot", // 게임 모드 (single/bot)
  playerName: "Player", // 입력받은 플레이어 이름
  human: newPlayerState(),
  bot: newPlayerState(),
  dice: [1, 1, 1, 1, 1], // 현재 주사위 눈금
  held: [false, false, false, false, false], // 각 주사위의 홀드 여부
  rollsUsed: 0, // 이번 턴에 굴린 횟수 (최대 3)
  gameOver: false,
  busy: false, // 애니메이션/봇 턴 진행 중이라 입력을 막아야 하는 상태
  hasRolled: false, // 이번 턴에 한 번이라도 굴렸는지 여부(점수 표기용)
};

// scores 배열에서 필요할 때마다 어떤 족보를 이미 썼는지를 계산해 반환.
// 별도 필드로 저장하지 X : scores와 상태가 어긋나는 문제를 방지하기 위해 매번 계산함.
function usedMask(p) {
  let m = 0;
  p.scores.forEach((s, i) => { if (s !== null) m |= (1 << i); });
  return m;
}

// 로컬 스토리지 (전적/랭킹 저장)
const Storage = {
  // 저장된 데이터를 읽어온다. 없으면 빈 기본값을 반환.
  get() {
    const data = localStorage.getItem("yacht_data");
    return data ? JSON.parse(data) : { highScores: [], wins: 0, losses: 0 };
  },
  // 데이터를 JSON 문자열로 직렬화해 저장.
  save(data) {
    localStorage.setItem("yacht_data", JSON.stringify(data));
  }
};

// 홈 화면의 최고 점수 / 전적 텍스트를 갱신.
function updateHomeStats() {
  const data = Storage.get();
  const top = data.highScores.length > 0 ? data.highScores[0] : null;
  el("#preview-single").textContent = top 
    ? `최고 점수: ${top.name} ${top.score}점` 
    : `최고 점수: 0점`;
  el("#preview-bot").textContent = `전적: ${data.wins}승 ${data.losses}패`;
}

// 싱글모드 랭킹 보드(Top 6까지) 랜더링
function renderRanking() {
  const data = Storage.get();
  const container = el(".ranking-content");
  if (data.highScores.length === 0) {
    container.innerHTML = "랭킹 데이터가 없습니다.<br>첫 게임을 플레이해보세요!";
    return;
  }
  container.innerHTML = data.highScores.map((entry, i) => 
    `<div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--line);">
      <span>${i + 1}. ${entry.name}</span> <span style="color:var(--gold-bright); font-weight:bold;">${entry.score}점</span>
    </div>`
  ).join("");
}

// 점수 계산. 한 플레이어의 상단/하단/보너스/총점을 계산해서 반환한다. 매번 배열을 다시 훑어 계산.
function totalScore(p) {
  const upper = p.scores.slice(0, 6).reduce((a, b) => a + (b || 0), 0);
  const lower = p.scores.slice(6).reduce((a, b) => a + (b || 0), 0);
  const bonus = upper >= UPPER_CAP ? BONUS : 0;
  return { upper, bonus, lower, total: upper + bonus + lower };
}

// 뷰 렌더링. 현재 game.dice/game.held 상태에 맞춰 주사위 5개를 다시 그린다.
function renderDice() {
  const container = el("#dice-area");
  container.innerHTML = "";
  // 사람 턴이고, 굴린 적이 있고, 아직 3번을 다 안 굴렸을 때만 클릭으로 홀드 토글이 가능.
  const canToggle = game.turn === "human" && !game.busy && game.rollsUsed > 0 && game.rollsUsed < 3;
  // 눈금별로 켜야 할 pip(점) 위치. 3x3 그리드의 p1~p9 중 어디를 보이게 할지 정의.
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

// 플레이어의 점수판을 현재 상태에 맞춰 다시 그린다. human/bot이 동일한 로직을 공유.
function renderScoreboard(playerKey, panelSel) {
  const p = game[playerKey];
  const panel = el(panelSel);
  const counts = countsOf(game.dice), sum = game.dice.reduce((a, b) => a + b, 0);
  // 지금 이 플레이어의 턴이고, 이미 굴렸고, 연출 중이 아닐 때 -> 점수 미리보기 표시
  const canPreview = game.turn === playerKey && game.hasRolled && !game.busy;
  // 미리보기 조건 충족했고 플레이어가 사람일 때 -> 클릭과 선택 가능
  const canClick = playerKey === "human" && canPreview;

  panel.querySelectorAll("[data-cat]").forEach(tr => {
    const c = parseInt(tr.dataset.cat, 10);
    const scoreTd = tr.querySelector(".score-cell");
    const used = p.scores[c] !== null;

    tr.className = ""; scoreTd.className = "score-cell";
    if (used) {
      scoreTd.textContent = p.scores[c];
      tr.classList.add("used");
    } else if (canPreview) {
      scoreTd.textContent = categoryScore(c, counts, sum);
      scoreTd.classList.add("preview");
      if (canClick) tr.classList.add("selectable");
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

// 주사위, 점수판, 라운드, 굴리기 버튼 상태 등 화면을 game 상태에 맞춰 갱신. game 객체가 바뀔 때마다 호출됨.
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

// 주사위가 굴러가는 것처럼 짧은 간격으로 값을 바꿔가며 보여준 뒤, 최종값(finalDice)으로 고정.
// keepPos : 각 주사위의 홀드 여부. (true면 굴리지 않고 그대로 유지 & 애니메이션 X)
async function animateDiceRoll(keepPos, finalDice) {
  game.busy = true; renderUI();
  for (let i = 0; i < 10; i++) {
    game.dice = game.dice.map((v, idx) => keepPos[idx] ? v : rollDie());
    renderDice();
    await sleep(80);
  }
  game.dice = finalDice.slice();
  game.hasRolled = true;
  game.busy = false; renderUI();
}

// 플레이어 & 봇 턴 로직
// 주사위 굴리기 버튼 클릭 핸들러. 게임이 끝난 상태에선 재시작으로 취급.
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

// 사람이 점수판의 한 칸(cat)을 클릭해 족보를 확정할 때 호출되는 함수.
function humanPickCategory(cat) {
  const p = game.human;
  if (p.scores[cat] !== null) return; // 이미 사용된 족보는 무시.
  
  const sc = categoryScore(cat, countsOf(game.dice), game.dice.reduce((a,b)=>a+b,0));
  p.scores[cat] = sc;

  if (IS_UPPER[cat]) p.upper = Math.min(UPPER_CAP, p.upper + sc);
  endHumanTurn();
}

// 사람 턴이 끝날 때 모드에 따라 다음 라운드로 넘어가거나 봇 턴을 시작한다.
async function endHumanTurn() {
  game.busy = true; renderUI();
  await sleep(TIMING.TURN_SWITCH);
  
  if (game.mode === "single") {
    finishRoundAndSwitch();
  } else {
    game.turn = "bot"; game.dice = [1, 1, 1, 1, 1]; game.rollsUsed = 0; game.busy = false;
    game.hasRolled = false;
    renderUI();
    await botTurn();
  }
}

// 봇의 턴 진행.
// 1차 굴림 → 홀드 → 2차 굴림 → 홀드 → 3차 굴림 → 최종 족보 선택 순서로 진행. 각 단계 사이에 THINK만큼 대기.
async function botTurn() {
  game.busy = true; renderUI();
  // ai_engine.js을 참고하여 g0: 2차 굴림 전 홀드 판단, g1: 1차 굴림 전 홀드 판단
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
  const decision = decideCategory(dice, usedMask(game.bot), game.bot.upper);
  game.bot.scores[decision.cat] = decision.score;
  if (IS_UPPER[decision.cat]) game.bot.upper = decision.newUpper;
  
  renderUI();
  await sleep(TIMING.TURN_SWITCH);
  finishRoundAndSwitch();
}

// 봇의 홀드를 화면에 순차적으로 반영, 홀드하지 않은 주사위만 다시 굴린다. 5개를 전부 홀드 시 재굴림 X.
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
// 마지막 라운드 초과 시 게임을 종료한다.
// vs봇 모드에서는 두 턴(human→bot)이 끝나야 라운드가 1 증가하고, 싱글 모드에서는 한 턴마다 라운드 증가.
function finishRoundAndSwitch() {
  if (game.mode === "single" || game.turn === "bot") game.round++;
  
  if (game.round > N_CAT) {
    endGame(); return;
  }
  game.turn = "human"; game.dice = [1, 1, 1, 1, 1]; game.held = [false, false, false, false, false];
  game.rollsUsed = 0; game.busy = false;
  game.hasRolled = false;
  renderUI();
}

// 게임 종료 처리. 결과 메시지 계산, 랭킹/전적을 localStorage에 반영, 종료 배너 표시.
function endGame() {
  game.gameOver = true; game.busy = true;
  const h = totalScore(game.human), b = totalScore(game.bot);
  const data = Storage.get();
  let msg;

  if (game.mode === "single") {
    msg = `게임 종료! 최종 점수: ${h.total}점`;
    data.highScores.push({ name: game.playerName, score: h.total });
    data.highScores.sort((x, y) => y.score - x.score); 
    data.highScores = data.highScores.slice(0, 6); 
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

// 화면 전환 및 초기화
// 지정된 view-section만 보이게 하고 나머지는 숨기기. pushState가 true면 뒤로가기도 지원.
function navigateToView(viewId, pushState = true) {
  document.querySelectorAll(".view-section").forEach(e => e.classList.add("hidden"));
  document.getElementById(viewId).classList.remove("hidden");
  
  // 브라우저 히스토리에 기록을 남김
  if (pushState) {
    history.pushState({ viewId: viewId }, "", "");
  }
}

// 이름 입력 검증 실패 시 인라인 에러 메시지 표시.
function showNameError(msg) {
  const errEl = el("#name-error");
  const inputEl = el("#player-name-input");
  errEl.textContent = msg;
  errEl.classList.remove("hidden");
  // display:none 해제 직후 트랜지션이 걸리도록 한 프레임 늦게 클래스 부여.
  requestAnimationFrame(() => errEl.classList.add("show")); 
  inputEl.classList.add("input-invalid");
}

// 이름 입력 에러 표시를 지우기. 이름을 다시 입력할 때 호출됨.
function clearNameError() {
  const errEl = el("#name-error");
  errEl.classList.remove("show");
  el("#player-name-input").classList.remove("input-invalid");
}

// 게임 시작 버튼 클릭 시 호출됨. 이름 검증, 화면 세팅, game 상태 초기화, 게임 화면으로 전환 순서.
function startGame(selectedMode) {
  const inputName = el("#player-name-input").value.trim();
  // 정규표현식 : 한글/영문/숫자만 허용, 1~6자 (공백·특수문자 금지)
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

  // 게임 상태 리셋 파트
  game.round = 1; game.turn = "human"; game.gameOver = false; game.busy = false;
  game.human = newPlayerState(); game.bot = newPlayerState();
  game.dice = [1, 1, 1, 1, 1]; game.held = [false, false, false, false, false]; game.rollsUsed = 0;
  game.hasRolled = false;

  el("#game-over-banner").classList.add("hidden");
  renderUI();
  navigateToView("view-game");
}

// 보드 생성, AI 엔진 준비, 각종 이벤트 리스너 등록
window.addEventListener("DOMContentLoaded", () => {
  initBoards(); // human,bot 점수판 DOM을 CATEGORY_NAMES 기반으로 생성
  setupAIEngine(); // 봇이 쓸 조합/확률 테이블 사전 계산
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

  // 이벤트 위임 
  // 보드판을 새로 그릴 때마다 addEventListener를 반복하지 않기 위해 부모(#panel-human)에만 리스너를 걸어 클릭된 칸을 역추적하기.
  el("#panel-human").addEventListener("click", (e) => {
    const tr = e.target.closest(".selectable[data-cat]");
    if (tr && !game.busy) humanPickCategory(parseInt(tr.dataset.cat, 10));
  });

  // 최초 진입 상태 기억
  history.replaceState({ viewId: "view-home" }, "", "");
  navigateToView("view-home", false);
});

// 뒤로가기/앞으로가기 지원.
window.addEventListener("popstate", (e) => {
  if (e.state && e.state.viewId) {
    navigateToView(e.state.viewId, false); // 히스토리 추가 생성 없이 화면만 토글
  }
});