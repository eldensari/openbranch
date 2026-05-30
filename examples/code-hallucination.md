# Example: Code hallucination — the `asyncpg-listen` phantom library

This is the canonical hackathon demo. Click **Try the demo** on the welcome
screen to preload it.

## User prompt

> Write a Python async function using the `asyncpg-listen` library to subscribe
> to a PostgreSQL channel and process notifications with automatic reconnection.

## Why this prompt

The `asyncpg-listen` package **does not exist on PyPI**. A single coding
assistant typically fabricates a plausible-looking implementation that fails
at `pip install`. This is the "phantom library" hallucination — a real
production hazard for AI coding assistants used by developers every day.

## Expected team output

### 🟢 Executor

Confidently writes broken code:

```python
from asyncpg_listen import Listener, NotificationHandler

async def listen_channel(channel_name: str):
    listener = Listener(dsn="postgresql://...", auto_reconnect=True)
    async for notification in listener.subscribe(channel_name):
        ...
```

### 🟡 Validator

> **UNVERIFIED** — the `asyncpg-listen` package is not registered on PyPI.
> `asyncpg`'s built-in `connection.add_listener()` provides equivalent
> functionality.

### 🔴 Critic

> **REJECT** — imports a non-existent dependency. Will fail at `pip install`.
> Code cannot run. Recommend asyncpg's native listener API.

### 🟣 Master (Korean, plain language)

```
🛑 팀이 환각을 발견했습니다.

- Executor가 'asyncpg-listen' 라이브러리로 코드를 작성했지만
- Validator: 이 라이브러리는 실제 존재하지 않습니다 (PyPI에 없음)
- Critic: pip install 단계에서 바로 실패할 코드입니다

✅ 검증된 대안: asyncpg의 내장 add_listener() 사용
```

(followed by a verified code block using `asyncpg`'s real listener API).

## Why this matters

A solo AI assistant — even a frontier model — will produce the broken code with
high confidence. The team's structure catches the failure cheaply, in plain
language, before it reaches a developer's terminal.
