// ai_engine.js
// 봇의 두뇌. state_values.js에 미리 계산된 테이블(YACHT_STATE_VALUES)을 참조해 주사위 홀드와 족보 등록을 결정.

"use strict";
import { N_CAT, IS_UPPER, UPPER_CAP, BONUS, categoryScore, countsOf } from './rules.js';
import { YACHT_STATE_VALUES } from './state_values.js';

// 사전 계산 데이터(조합 목록, 확률 테이블 등)를 담아두는 네임스페이스. setupAIEngine()이 호출되며 채워진다.
const AI = {};

// 1~n 사이의 수를 중복 허용하여 k개 고르는 모든 조합을 생성. 주사위 5개의 가능한 모든 눈금 조합 생성.
function combosWithReplacement(n, k) {
  const result = [];
  const cur = [];
  (function rec(start) {
    if (cur.length === k) { result.push(cur.slice()); return; }
    for (let v = start; v <= n; v++) { cur.push(v); rec(v); cur.pop(); }
  })(1);
  return result;
}

// 게임 시작 시 호출, 주사위 조합/확률/점수 테이블을 미리 만들어 AI 객체에 채워 넣고 게임 내내 사용함.
function setupAIEngine() {
  // 주사위 5개로 나올 수 있는 모든 조합(정렬된 형태), 예: [1,1,2,3,6]
  const combos = combosWithReplacement(6, 5); 
  const comboIndex = new Map();
  combos.forEach((c, i) => comboIndex.set(c.join(","), i));

  // 0~5개까지, "홀드할 주사위 조합"으로 가능한 모든 부분집합
  const keeps = [];
  for (let k = 0; k <= 5; k++) keeps.push(...combosWithReplacement(6, k));
  const keepIndex = new Map();
  keeps.forEach((c, i) => keepIndex.set(c.join(","), i));
  const emptyKeepIdx = keepIndex.get("");

  const N_COMBO = combos.length, N_KEEP = keeps.length;
  const comboCounts = combos.map(countsOf);
  const comboSum = combos.map(c => c.reduce((a, b) => a + b, 0));

  // keep 조합 인덱스. 이 조합을 홀드하고 나머지를 다시 굴렸을 때, 각 최종 조합이 나올 확률의 백터.
  const REROLL = new Array(N_KEEP);
  for (let ki = 0; ki < N_KEEP; ki++) {
    const kt = keeps[ki];
    const r = 5 - kt.length; // 다시 굴릴 주사위 개수
    const row = new Float64Array(N_COMBO);
    if (r === 0) {
      // 5개를 전부 홀드하면 결과는 그대로 확정(확률 1)
      const ci = comboIndex.get(kt.slice().sort((a, b) => a - b).join(","));
      row[ci] = 1.0;
    } else {
      // r개를 다시 굴려 나올 수 있는 모든 경우(6^r가지)를 전수 조사해 확률을 누적
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

  // 콤보 인덱스. 이 주사위 조합에서 실제로 홀드 가능한 keep 조합들의 인덱스 목록.
  // 예: 주사위가 [1,1,2]면 keep으로 [1,1]은 가능하지만 [1,1,1]은 불가능
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

  // 조합으로 그 족보를 선택했을 때 점수. 매번 categoryScore를 다시 계산하지 않도록 미리 표로 만들어둠.
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

// mask: 사용한 족보 비트마스크, u: 현재 상단 누적 점수
// 남은 게임 전체에 대한 기대 총점을 사전 계산 테이블에서 조회.
function getV(mask, u) {
  return YACHT_STATE_VALUES.values[mask * 64 + u];
}

// 각 굴림 단계(1~3번째)에서 최적의 홀드와 최종 기대점수를 계산하기 위한 기대값 벡터를 생성.
// f는 현재 상태의 기대값, g는 다음 굴림 전 최적 홀드 선택 기준으로 변환한 기대값.
function computeValueVectors(mask, u) {
  // 아직 채우지 않은 족보 목록
  const remaining = [];
  for (let c = 0; c < N_CAT; c++) if (!(mask & (1 << c))) remaining.push(c);

  // 각 최종 주사위 조합에서, "지금 이 조합으로 어떤 족보를 고르는 게 가장 이득인가"를 계산
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

  // vec(조합별 기대값)을 "keep 조합별 기대값"으로 변환
  // = 그 keep으로 다시 굴렸을 때 나올 수 있는 모든 결과의 확률 가중 평균
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
  // gvec(keep 조합별 기대값)을, "현재 주사위 조합에서 고를 수 있는 keep들 중 최댓값"으로 압축
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

// 현재 주사위와 기대값 벡터를 바탕으로 어떤 주사위들을 홀드할지 멀티셋 형태로 결정.
function decideKeep(diceArr, gVector) {
  const sorted = diceArr.slice().sort((a, b) => a - b);
  const ci = AI.comboIndex.get(sorted.join(","));
  let bestKi = -1, best = -Infinity;
  for (const ki of AI.subMultisets[ci]) {
    if (gVector[ki] > best) { best = gVector[ki]; bestKi = ki; }
  }
  return AI.keeps[bestKi];
}

// 위 함수의 반환값을 -> 실제 주사위 배열의 몇 번째 위치를 홀드할지 boolean 배열로 변환한다.
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

// 최종 확정된 주사위로 어떤 족보(cat)를 선택할지 결정.
function decideCategory(diceArr, mask, u) {
  const counts = countsOf(diceArr);
  const sum = diceArr.reduce((a, b) => a + b, 0);
  let best = -Infinity, bestCat = -1, bestScore = 0, bestBonus = 0, bestNewU = u;
  for (let cat = 0; cat < N_CAT; cat++) {
    if (mask & (1 << cat)) continue; // 이미 사용한 족보는 제외
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

export { setupAIEngine, computeValueVectors, decideKeep, decideCategory, positionsToKeep };