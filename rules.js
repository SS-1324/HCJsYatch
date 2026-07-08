// rules.js
// 요트 다이스의 규칙만 모아둔 파일.

"use strict";

// 족보 이름(화면 표시용). 배열의 인덱스(0~11) = 카테고리 번호(cat)
export const CATEGORY_NAMES = ["에이스", "듀스", "트리플", "포카드", "파이브", "식스", "초이스", "포카인드", "풀하우스", "스몰 스트레이트", "라지 스트레이트", "요트"];

// 전체 족보 개수 (상단 6개 + 하단 6개= 12개)
export const N_CAT = 12;

// 각 인덱스가 숫자 족보인지의 여부. true면 upper 합계(+35점 계산용)에 더해짐.
export const IS_UPPER = [true, true, true, true, true, true, false, false, false, false, false, false];

// 상단 족보(숫자 족보) 합계가 이 값 이상이면 보너스 획득
export const UPPER_CAP = 63;
// 보너스 점수
export const BONUS = 35;

// 주사위 1개를 굴려 1~6 중 하나를 반환
export function rollDie() { return 1 + Math.floor(Math.random() * 6); }

// 주사위 배열을 눈금 개수로 반환
// 인덱스 0은 사용 X. 1~6 인덱스에 각 눈금이 몇 개 나왔는지 저장. 예: [3,3,5,1,1] → [0,2,0,2,0,1,0] 는 1이 2개, 3이 2개, 5가 1개.
export function countsOf(diceArr) {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const v of diceArr) c[v]++;
  return c;
}

// 주어진 주사위 상태(counts, sum)에서 특정 족보(cat)를 선택했을 때 얻는 점수를 계산한다.
// cat 0~5 : 에이스~식스 (해당 눈금 개수 * 눈금 값. 예 : 3 주사위 4개는 3 * 4 = 12 점)
// cat 6 : 초이스 (주사위 합 전체)
// cat 7 : 포카인드 (같은 눈금 4개 이상 있으면 합 전체, 아니면 0)
// cat 8 : 풀하우스 (3개+2개 조합-혹은 5개가 같아도 인정- 눈금 합 전체. 아니면 0.)
// cat 9 : 스몰 스트레이트 (4개 연속 눈금. 고정 15점)
// cat 10 : 라지 스트레이트 (5개 연속 눈금. 고정 30점)
// cat 11 : 요트 (같은 눈금 5개. 고정 50점)
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