// rules.js

"use strict";

export const CATEGORY_NAMES = ["에이스", "듀스", "트리플", "포카드", "파이브", "식스", "초이스", "포카인드", "풀하우스", "스몰 스트레이트", "라지 스트레이트", "요트"];
export const N_CAT = 12;
export const IS_UPPER = [true, true, true, true, true, true, false, false, false, false, false, false];
export const UPPER_CAP = 63;
export const BONUS = 35;

export function rollDie() { return 1 + Math.floor(Math.random() * 6); }

export function countsOf(diceArr) {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const v of diceArr) c[v]++;
  return c;
}

export function categoryScore(cat, counts, sum) {
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