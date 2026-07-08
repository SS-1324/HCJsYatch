// ai_engine.js

"use strict";
import { N_CAT, IS_UPPER, UPPER_CAP, BONUS, categoryScore, countsOf } from './rules.js';
import { YACHT_STATE_VALUES } from './state_values.js';

// AI 두뇌 모듈 : 전략 연산 및 확률 계산 엔진

const AI = {}; // 전역 AI 엔진 데이터 네임스페이스

function combosWithReplacement(n, k) {
  const result = [];
  const cur = [];
  (function rec(start) {
    if (cur.length === k) { result.push(cur.slice()); return; }
    for (let v = start; v <= n; v++) { cur.push(v); rec(v); cur.pop(); }
  })(1);
  return result;
}

function setupAIEngine() {
  const combos = combosWithReplacement(6, 5); 
  const comboIndex = new Map();
  combos.forEach((c, i) => comboIndex.set(c.join(","), i));

  const keeps = [];
  for (let k = 0; k <= 5; k++) keeps.push(...combosWithReplacement(6, k));
  const keepIndex = new Map();
  keeps.forEach((c, i) => keepIndex.set(c.join(","), i));
  const emptyKeepIdx = keepIndex.get("");

  const N_COMBO = combos.length, N_KEEP = keeps.length;
  const comboCounts = combos.map(countsOf);
  const comboSum = combos.map(c => c.reduce((a, b) => a + b, 0));

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

function decideKeep(diceArr, gVector) {
  const sorted = diceArr.slice().sort((a, b) => a - b);
  const ci = AI.comboIndex.get(sorted.join(","));
  let bestKi = -1, best = -Infinity;
  for (const ki of AI.subMultisets[ci]) {
    if (gVector[ki] > best) { best = gVector[ki]; bestKi = ki; }
  }
  return AI.keeps[bestKi];
}

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

export { setupAIEngine, computeValueVectors, decideKeep, decideCategory, positionsToKeep };