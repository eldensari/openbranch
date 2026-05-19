# Example: Travel hallucination — local-knowledge domain

Same team pattern, different domain. Useful for showing that AI Team Validation
isn't code-specific.

## User prompt

> What time does the last subway leave Gangnam Station heading south on
> weekends?

## Why this prompt

Public-transit schedules are notoriously unreliable in LLM responses. Models
often fabricate plausible times based on global knowledge or outdated data.
A solo agent confidently states a specific minute; the team forces a
"I cannot verify" answer.

## Expected team behavior

- **🟢 Executor** — produces a specific-looking time (e.g. "11:42 PM").
- **🟡 Validator** — verdict line: **UNVERIFIED** — schedules change; the
  authoritative source is `https://www.seoulmetro.co.kr/`. No model snapshot
  reflects the current weekend schedule.
- **🔴 Critic** — verdict line: **WARN** — committing to a specific minute
  without source is unsafe; user could miss the train.
- **🟣 Master (Korean)** —
  ```
  ⚠️ 정확한 시각은 확인 불가
  - Executor가 구체 시각을 제시했지만
  - Validator: 출처 없음, 변경 가능
  - Critic: 분 단위 약속은 위험

  ✅ 권장: Seoul Metro 공식 사이트(seoulmetro.co.kr)에서 당일 시각 확인
  ```

## Why this matters

The "phantom library" pattern (code hallucination) is the most pitchable
example because it's deterministic and visually verifiable. But the same team
structure catches subtler failures in domains where ground truth is volatile
(transit, scores, hours, recent events) — domains where confident wrong
answers are common in production AI products.
