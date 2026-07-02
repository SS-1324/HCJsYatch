"use strict";

/* =========================================================
   0. 기본 규칙 상수
   ========================================================= */
const CATEGORY_KEYS = [
  "aces", "deuces", "threes", "fours", "fives", "sixes",
  "choice", "fourKind", "fullHouse", "smallStraight", "largeStraight", "yacht"
];
const CATEGORY_NAMES = [
  "에이스", "듀스", "트리플", "포카드", "파이브", "식스",
  "초이스", "포카인드", "풀하우스", "스몰 스트레이트", "라지 스트레이트", "요트"
];
const N_CAT = 12;
const IS_UPPER = [true, true, true, true, true, true, false, false, false, false, false, false];
const UPPER_CAP = YACHT_STATE_VALUES.upper_cap; // 63
const BONUS = YACHT_STATE_VALUES.bonus; // 35

function rollDie() { return 1 + Math.floor(Math.random() * 6); }

function countsOf(diceArr) {
  const c = [0, 0, 0, 0, 0, 0, 0]; // index 1..6 사용
  for (const v of diceArr) c[v]++;
  return c;
}

// 다이스 배열(counts, sum)로부터 카테고리 점수 계산 (요트 = 포카인드/풀하우스 겸용 규칙 포함)
function categoryScore(cat, counts, sum) {
  if (cat < 6) return counts[cat + 1] * (cat + 1);
  if (cat === 6) return sum; // 초이스
  if (cat === 7) { // 포카인드: 같은 눈 4개 이상 (요트 포함)
    for (let f = 1; f <= 6; f++) if (counts[f] >= 4) return sum;
    return 0;
  }
  if (cat === 8) { // 풀하우스: (3+2) 또는 5개 동일(요트)
    let has3 = false, has2 = false, has5 = false;
    for (let f = 1; f <= 6; f++) {
      if (counts[f] === 3) has3 = true;
      if (counts[f] === 2) has2 = true;
      if (counts[f] === 5) has5 = true;
    }
    return (has3 && has2) || has5 ? sum : 0;
  }
  if (cat === 9) { // 스몰 스트레이트
    const p = [false];
    for (let f = 1; f <= 6; f++) p.push(counts[f] > 0);
    const small = (p[1] && p[2] && p[3] && p[4]) || (p[2] && p[3] && p[4] && p[5]) || (p[3] && p[4] && p[5] && p[6]);
    return small ? 15 : 0;
  }
  if (cat === 10) { // 라지 스트레이트
    const p = [false];
    for (let f = 1; f <= 6; f++) p.push(counts[f] > 0);
    const large = (p[1] && p[2] && p[3] && p[4] && p[5]) || (p[2] && p[3] && p[4] && p[5] && p[6]);
    return large ? 30 : 0;
  }
  if (cat === 11) { // 요트
    for (let f = 1; f <= 6; f++) if (counts[f] === 5) return 50;
    return 0;
  }
  return 0;
}

/* =========================================================
   1. AI 계산 엔진 셋업 (페이지 로드시 1회)
   ========================================================= */
function combosWithReplacement(n, k) {
  const result = [];
  const cur = [];
  (function rec(start) {
    if (cur.length === k) { result.push(cur.slice()); return; }
    for (let v = start; v <= n; v++) { cur.push(v); rec(v); cur.pop(); }
  })(1);
  return result;
}

const AI = {}; // 전역 AI 엔진 데이터 네임스페이스

function setupAIEngine() {
  const combos = combosWithReplacement(6, 5); // 252
  const comboIndex = new Map();
  combos.forEach((c, i) => comboIndex.set(c.join(","), i));

  const keeps = [];
  for (let k = 0; k <= 5; k++) keeps.push(...combosWithReplacement(6, k)); // 462
  const keepIndex = new Map();
  keeps.forEach((c, i) => keepIndex.set(c.join(","), i));
  const emptyKeepIdx = keepIndex.get("");

  const N_COMBO = combos.length, N_KEEP = keeps.length;

  const comboCounts = combos.map(countsOf);
  const comboSum = combos.map(c => c.reduce((a, b) => a + b, 0));

  // REROLL[ki] = 길이 252 확률분포 배열
  const REROLL = new Array(N_KEEP);
  for (let ki = 0; ki < N_KEEP; ki++) {
    const kt = keeps[ki];
    const r = 5 - kt.length;
    const row = new Float64Array(N_COMBO);
    if (r === 0) {
      const ci = comboIndex.get(kt.slice().sort((a, b) => a - b).join(","));
      row[ci] = 1.0;
    } else {
      const prob = 1.0 / Math.pow(6, r);
      const outcome = new Array(r).fill(1);
      const total = Math.pow(6, r);
      for (let n = 0; n < total; n++) {
        let x = n;
        for (let i = 0; i < r; i++) { outcome[i] = (x % 6) + 1; x = Math.floor(x / 6); }
        const final = kt.concat(outcome).sort((a, b) => a - b);
        const ci = comboIndex.get(final.join(","));
        row[ci] += prob;
      }
    }
    REROLL[ki] = row;
  }

  // 서브멀티셋: 각 combo에 대해 부분집합인 keep 인덱스 목록
  const subMultisets = new Array(N_COMBO);
  for (let ci = 0; ci < N_COMBO; ci++) {
    const cc = comboCounts[ci];
    const list = [];
    for (let ki = 0; ki < N_KEEP; ki++) {
      const kc = countsOf(keeps[ki]);
      let ok = true;
      for (let f = 1; f <= 6; f++) if (kc[f] > cc[f]) { ok = false; break; }
      if (ok) list.push(ki);
    }
    subMultisets[ci] = list;
  }

  // 카테고리별 점수 (상태 무관, 다이스에만 의존) : rawScore[cat][ci]
  const rawScore = [];
  for (let cat = 0; cat < N_CAT; cat++) {
    const arr = new Float64Array(N_COMBO);
    for (let ci = 0; ci < N_COMBO; ci++) arr[ci] = categoryScore(cat, comboCounts[ci], comboSum[ci]);
    rawScore.push(arr);
  }

  Object.assign(AI, {
    combos, comboIndex, keeps, keepIndex, emptyKeepIdx,
    N_COMBO, N_KEEP, comboCounts, comboSum, REROLL, subMultisets, rawScore
  });
}

function getV(mask, u) {
  return YACHT_STATE_VALUES.values[mask * 64 + u];
}

// 주어진 (mask,u) 상태에서 f0,g0,f1,g1 벡터를 계산 (턴당 1회)
function computeValueVectors(mask, u) {
  const remaining = [];
  for (let c = 0; c < N_CAT; c++) if (!(mask & (1 << c))) remaining.push(c);

  const f0 = new Float64Array(AI.N_COMBO);
  for (let ci = 0; ci < AI.N_COMBO; ci++) {
    let best = -Infinity;
    for (const cat of remaining) {
      const sc = AI.rawScore[cat][ci];
      let val;
      if (IS_UPPER[cat]) {
        const newU = Math.min(UPPER_CAP, u + sc);
        const bonus = (u < UPPER_CAP && newU >= UPPER_CAP) ? BONUS : 0;
        val = sc + bonus + getV(mask | (1 << cat), newU);
      } else {
        val = sc + getV(mask | (1 << cat), u);
      }
      if (val > best) best = val;
    }
    f0[ci] = best;
  }

  function applyReroll(vec) {
    const out = new Float64Array(AI.N_KEEP);
    for (let ki = 0; ki < AI.N_KEEP; ki++) {
      const row = AI.REROLL[ki];
      let s = 0;
      for (let ci = 0; ci < AI.N_COMBO; ci++) { const p = row[ci]; if (p !== 0) s += p * vec[ci]; }
      out[ki] = s;
    }
    return out;
  }
  function collapseByKeep(gvec) {
    const out = new Float64Array(AI.N_COMBO);
    for (let ci = 0; ci < AI.N_COMBO; ci++) {
      let best = -Infinity;
      for (const ki of AI.subMultisets[ci]) if (gvec[ki] > best) best = gvec[ki];
      out[ci] = best;
    }
    return out;
  }

  const g0 = applyReroll(f0);
  const f1 = collapseByKeep(g0);
  const g1 = applyReroll(f1);

  return { f0, g0, f1, g1 };
}

// 현재 다이스(정렬 안 된 배열)에서 gVector 기준 최적 keep 멀티셋을 고른다.
function decideKeep(diceArr, gVector) {
  const sorted = diceArr.slice().sort((a, b) => a - b);
  const ci = AI.comboIndex.get(sorted.join(","));
  let bestKi = -1, best = -Infinity;
  for (const ki of AI.subMultisets[ci]) {
    if (gVector[ki] > best) { best = gVector[ki]; bestKi = ki; }
  }
  return AI.keeps[bestKi]; // 유지할 눈들의 배열(멀티셋)
}

// keepMultiset(눈 값 배열)에 맞춰 실제 다이스 배열에서 어떤 "위치"를 유지할지 결정
function positionsToKeep(diceArr, keepMultiset) {
  const need = {};
  for (const v of keepMultiset) need[v] = (need[v] || 0) + 1;
  const keep = new Array(5).fill(false);
  for (let i = 0; i < 5; i++) {
    const v = diceArr[i];
    if (need[v] > 0) { keep[i] = true; need[v]--; }
  }
  return keep;
}

// 0 리롤 남은 상태: 최적 카테고리 선택
function decideCategory(diceArr, mask, u) {
  const counts = countsOf(diceArr);
  const sum = diceArr.reduce((a, b) => a + b, 0);
  let best = -Infinity, bestCat = -1, bestScore = 0, bestBonus = 0, bestNewU = u;
  for (let cat = 0; cat < N_CAT; cat++) {
    if (mask & (1 << cat)) continue;
    const sc = categoryScore(cat, counts, sum);
    let val, newU = u, bonus = 0;
    if (IS_UPPER[cat]) {
      newU = Math.min(UPPER_CAP, u + sc);
      bonus = (u < UPPER_CAP && newU >= UPPER_CAP) ? BONUS : 0;
      val = sc + bonus + getV(mask | (1 << cat), newU);
    } else {
      val = sc + getV(mask | (1 << cat), u);
    }
    if (val > best) { best = val; bestCat = cat; bestScore = sc; bestBonus = bonus; bestNewU = newU; }
  }
  return { cat: bestCat, score: bestScore, bonus: bestBonus, newUpper: bestNewU };
}

/* =========================================================
   2. 게임 상태
   ========================================================= */
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

const TIMING = {
  ROLL_DISPLAY: 800,
  THINK: 300,
  SELECT_STEP: 400,
  TO_REROLL: 400,
  TURN_SWITCH: 600,
};

function newPlayerState() {
  return { used: 0, upper: 0, scores: new Array(N_CAT).fill(null) };
}

const game = {
  round: 1,
  turn: "human", // 'human' | 'bot'
  human: newPlayerState(),
  bot: newPlayerState(),
  dice: [1, 1, 1, 1, 1],
  held: [false, false, false, false, false],
  rollsUsed: 0,
  gameOver: false,
  busy: false, // 애니메이션/봇 처리 중이면 사람 조작 막기
};

function totalScore(p) {
  let lower = 0;
  for (let c = 6; c < N_CAT; c++) lower += p.scores[c] || 0;
  let upper = 0;
  for (let c = 0; c < 6; c++) upper += p.scores[c] || 0;
  const bonus = upper >= UPPER_CAP ? BONUS : 0;
  return { upper, bonus, lower, total: upper + bonus + lower };
}

/* =========================================================
   3. 렌더링
   ========================================================= */
const el = (sel) => document.querySelector(sel);

function pipLayout(v) {
  // 1~6 눈에 대한 CSS grid-area 점 배치 클래스
  const map = {
    1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9],
  };
  return map[v];
}

function renderDie(container, value, held, clickable, onClick) {
  const die = document.createElement("div");
  die.className = "die" + (held ? " die--held" : "") + (clickable ? " die--clickable" : "");
  for (let i = 1; i <= 9; i++) {
    const dot = document.createElement("span");
    dot.className = "pip";
    dot.style.gridArea = `p${i}`;
    dot.style.visibility = pipLayout(value).includes(i) ? "visible" : "hidden";
    die.appendChild(dot);
  }
  if (clickable) die.addEventListener("click", onClick);
  container.appendChild(die);
}

function renderDice() {
  const container = el("#dice-area");
  container.innerHTML = "";
  const canToggle = game.turn === "human" && !game.busy && game.rollsUsed > 0 && game.rollsUsed < 3;
  game.dice.forEach((v, i) => {
    renderDie(container, v, game.held[i], canToggle, () => {
      game.held[i] = !game.held[i];
      renderDice();
    });
  });
}

function renderScoreboard(playerKey, panelSel) {
  const p = game[playerKey];
  const panel = el(panelSel);
  const tbody = panel.querySelector("tbody");
  tbody.innerHTML = "";
  const canPick = playerKey === "human" && game.turn === "human" && !game.busy && game.rollsUsed > 0;
  const counts = countsOf(game.dice);
  const sum = game.dice.reduce((a, b) => a + b, 0);

  for (let c = 0; c < N_CAT; c++) {
    const tr = document.createElement("tr");
    const used = (p.used & (1 << c)) !== 0;
    const nameTd = document.createElement("td");
    nameTd.textContent = CATEGORY_NAMES[c];
    tr.appendChild(nameTd);

    const scoreTd = document.createElement("td");
    scoreTd.className = "score-cell";
    if (used) {
      scoreTd.textContent = p.scores[c];
      tr.classList.add("used");
    } else if (canPick) {
      const preview = categoryScore(c, counts, sum);
      scoreTd.textContent = preview;
      scoreTd.classList.add("preview");
      tr.classList.add("selectable");
      tr.addEventListener("click", () => humanPickCategory(c));
    } else {
      scoreTd.textContent = "-";
      scoreTd.classList.add("empty");
    }
    tr.appendChild(scoreTd);
    tbody.appendChild(tr);
  }

  const t = totalScore(p);
  panel.querySelector(".upper-sum").textContent = `${t.upper} / ${UPPER_CAP}`;
  panel.querySelector(".bonus-val").textContent = t.bonus;
  panel.querySelector(".total-val").textContent = t.total;
}

function renderStatus(text) {
  el("#status-line").textContent = text;
}

function renderRollButton() {
  const btn = el("#roll-btn");
  if (game.turn !== "human" || game.busy || game.gameOver) {
    btn.disabled = true;
    btn.textContent = game.gameOver ? "게임 종료" : "AI 차례";
    return;
  }
  if (game.rollsUsed >= 3) {
    btn.disabled = true;
    btn.textContent = "족보를 선택하세요";
  } else {
    btn.disabled = false;
    btn.textContent = game.rollsUsed === 0 ? "주사위 굴리기 (1/3)" : `다시 굴리기 (${game.rollsUsed + 1}/3)`;
  }
}

function renderRound() {
  el("#round-line").textContent = `라운드 ${Math.min(game.round, N_CAT)} / ${N_CAT}`;
}

function renderAll() {
  renderDice();
  renderScoreboard("human", "#panel-human");
  renderScoreboard("bot", "#panel-bot");
  renderRollButton();
  renderRound();
  highlightTurn();
}

function highlightTurn() {
  el("#panel-human").classList.toggle("active-turn", game.turn === "human" && !game.gameOver);
  el("#panel-bot").classList.toggle("active-turn", game.turn === "bot" && !game.gameOver);
  
}

async function animateDiceRoll(keepPos, finalDice) {
  game.busy = true;
  renderRollButton(); // 구르는 동안 버튼 비활성화
  const duration = 800; // 0.8초
  const interval = 80;  // 0.08초마다 화면 갱신
  const steps = duration / interval;

  for (let i = 0; i < steps; i++) {
    // 킵(Keep)하지 않은 주사위만 무작위 눈으로 변경해서 보여줌
    game.dice = game.dice.map((v, idx) => keepPos[idx] ? v : rollDie());
    renderDice();
    await sleep(interval);
  }
  game.dice = finalDice.slice();
  game.busy = false;
  renderAll();
}

/* =========================================================
   4. 사람 턴
   ========================================================= */
async function humanRoll() {
  if (game.turn !== "human" || game.busy || game.rollsUsed >= 3) return;
  
  // 🎯 [수정] 7-2: 주사위를 처음(0번째) 굴릴 때만 킵(Hold) 상태를 초기화!
  if (game.rollsUsed === 0) {
    game.held = [false, false, false, false, false];
  }

  const finalDice = game.dice.slice();
  for (let i = 0; i < 5; i++) {
    if (!game.held[i]) finalDice[i] = rollDie(); // 안 잠긴 것만 결과값 생성
  }
  
  game.rollsUsed++;
  renderStatus("주사위를 굴리는 중...");
  
  // 🎯 [추가] 7-3: 완성된 애니메이션 호출
  await animateDiceRoll(game.held, finalDice);
  
  renderStatus("주사위를 클릭해 유지할 눈을 고르고, 다시 굴리거나 족보를 선택하세요.");
}

function humanPickCategory(cat) {
  const p = game.human;
  if (p.used & (1 << cat)) return;
  const counts = countsOf(game.dice);
  const sum = game.dice.reduce((a, b) => a + b, 0);
  const score = categoryScore(cat, counts, sum);
  p.scores[cat] = score;
  p.used |= (1 << cat);
  if (IS_UPPER[cat]) p.upper = Math.min(UPPER_CAP, p.upper + score);
  renderStatus(`"${CATEGORY_NAMES[cat]}"에 ${score}점을 기록했습니다.`);
  endHumanTurn();
}

async function endHumanTurn() {
  game.busy = true;
  renderAll();
  await sleep(TIMING.TURN_SWITCH);
  game.turn = "bot";
  game.dice = [1, 1, 1, 1, 1];
  game.rollsUsed = 0;
  game.busy = false;
  renderAll();
  await botTurn();
}

/* =========================================================
   5. 봇 턴 (AI, 타이밍 스펙 적용)
   ========================================================= */
async function botTurn() {
  game.busy = true;
  renderAll();

  const mask = game.bot.used, u = game.bot.upper;
  const { g0, g1 } = computeValueVectors(mask, u);

  // --- 1차 굴림 ---
  let dice = [rollDie(), rollDie(), rollDie(), rollDie(), rollDie()];
  game.held = [false, false, false, false, false]; // 봇도 킵 초기화
  renderStatus("AI가 주사위를 굴립니다...");
  
  // 🎯 [추가] 봇의 첫 굴림도 애니메이션 적용!
  await animateDiceRoll(game.held, dice);

  // --- 결정 1 (2 리롤 남음, g1 기준) ---
  await sleep(TIMING.THINK);
  let keep = decideKeep(dice, g1);
  dice = await botApplyKeepAndReroll(dice, keep);

  // --- 결정 2 (1 리롤 남음, g0 기준) ---
  await sleep(TIMING.THINK);
  keep = decideKeep(dice, g0);
  dice = await botApplyKeepAndReroll(dice, keep);

  // --- 최종 족보 선택 ---
  renderStatus("AI가 족보를 고르는 중...");
  await sleep(TIMING.THINK);
  const decision = decideCategory(dice, mask, u);
  game.bot.scores[decision.cat] = decision.score;
  game.bot.used |= (1 << decision.cat);
  if (IS_UPPER[decision.cat]) game.bot.upper = decision.newUpper;
  renderStatus(`AI가 "${CATEGORY_NAMES[decision.cat]}"에 ${decision.score}점을 기록했습니다.`);
  renderAll();

  await sleep(TIMING.TURN_SWITCH);
  finishRoundAndSwitch();
}

async function botApplyKeepAndReroll(dice, keepMultiset) {
  if (keepMultiset.length === 5) {
    return dice; // 전부 유지 = 굴리지 않음
  }
  const keepPos = positionsToKeep(dice, keepMultiset);

  // 🎯 [수정] 7-1: 봇도 사람처럼 하나씩 클릭해서 골드 색상(held)으로 만드는 애니메이션
  for (let i = 0; i < 5; i++) {
    if (keepPos[i] && !game.held[i]) {
      game.held[i] = true; 
      renderDice(); // 화면에 즉시 반영
      await sleep(TIMING.SELECT_STEP);
    }
  }
  await sleep(TIMING.TO_REROLL);

  const newDice = dice.map((v, i) => (keepPos[i] ? v : rollDie()));
  
  renderStatus("AI가 남은 주사위를 다시 굴립니다...");
  // 🎯 [추가] 7-3: 봇의 리롤에도 롤링 애니메이션 적용
  await animateDiceRoll(game.held, newDice);
  
  return newDice;
}


/* =========================================================
   6. 라운드 진행 및 게임 종료
   ========================================================= */
function finishRoundAndSwitch() {
  if (game.turn === "bot") {
    game.round++;
  }
  if (game.round > N_CAT) {
    endGame();
    return;
  }
  game.turn = "human";
  game.dice = [1, 1, 1, 1, 1];
  game.held = [false, false, false, false, false];
  game.rollsUsed = 0;
  game.busy = false;
  renderStatus("당신의 차례입니다. 주사위를 굴려주세요.");
  renderAll();
}

function endGame() {
  game.gameOver = true;
  game.busy = true;
  const h = totalScore(game.human), b = totalScore(game.bot);
  let msg;
  if (h.total > b.total) msg = `게임 종료! 당신의 승리입니다 (${h.total} : ${b.total})`;
  else if (h.total < b.total) msg = `게임 종료! AI의 승리입니다 (${b.total} : ${h.total})`;
  else msg = `게임 종료! 무승부입니다 (${h.total} : ${b.total})`;
  renderStatus(msg);
  renderAll();
  el("#game-over-banner").textContent = msg;
  el("#game-over-banner").classList.remove("hidden");
}

/* =========================================================
   7. 초기화
   ========================================================= */
function resetGame() {
  game.round = 1;
  game.turn = "human";
  game.human = newPlayerState();
  game.bot = newPlayerState();
  game.dice = [1, 1, 1, 1, 1];
  game.held = [false, false, false, false, false];
  game.rollsUsed = 0;
  game.gameOver = false;
  game.busy = false;
  el("#game-over-banner").classList.add("hidden");
  renderStatus("당신의 차례입니다. 주사위를 굴려주세요.");
  renderAll();
}

window.addEventListener("DOMContentLoaded", () => {
  setupAIEngine();
  el("#roll-btn").addEventListener("click", humanRoll);
  el("#reset-btn").addEventListener("click", resetGame);
  renderStatus("당신의 차례입니다. 주사위를 굴려주세요.");
  renderAll();
});
