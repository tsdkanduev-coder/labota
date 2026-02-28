# Labota (Nabu) — Work Log

> Рабочий журнал всего проекта: voice-call, calendar, бот, фронт, инфра.
> Обновляется по ходу работы.

---

## Проект: обзор

**Nabu** — персональный консьерж-ассистент в Telegram на платформе OpenClaw.

| Направление               | Статус               | Ключевые файлы                             |
| ------------------------- | -------------------- | ------------------------------------------ |
| **Voice-call** (звонки)   | Прод, Voximplant     | `extensions/voice-call/`                   |
| **Calendar** (расписание) | Прод, read-only MVP  | `extensions/nabu-calendar/`                |
| **Bot persona** (SOUL)    | Прод                 | `workspace/SOUL.md`                        |
| **iOS app**               | Scaffold, не в проде | `apps/LabotaCalendarPreview/`, `apps/ios/` |
| **Android/macOS**         | Scaffold             | `apps/android/`, `apps/macos/`             |

---

## Voice-Call

### Фаза 1: Базовый voice-call (янв 2026)

- `367baaca2` 11 янв — Первая реализация voice-call plugin
- Providers: Twilio (Programmable Voice + Media Streams), Telnyx
- Outbound notify + conversation modes
- OpenAI Realtime STT через media WebSocket
- TTS: OpenAI + ElevenLabs, Say fallback
- Tool `voice_call`: initiate/continue/speak/end/status
- CLI: `openclaw voicecall` commands

### Фаза 2: Voximplant + стабилизация (фев 2026)

- `66062d786` — Voximplant provider, webhook proxy через gateway
- Серия фиксов auth, stream encoding, binary media detection
- `1a6961601` — Стабилизация voximplant auth + binary media

### Фаза 3: Realtime Conversation (20-22 фев)

- `a05fdbc85` — Realtime conversation mode с direct assistant audio pipeline
- `65bff8113` — semantic_vad для turn detection
- `f96e5fa44` — Unified prompt вместо objective/context/message triple
- `0d25c99cc` — Programmatic prompt assembly + forced opening + gateway contract
- `df7997281` — Few-shot prompt с role + examples + mandatory booking fields
- `46a0c4bd3` — Fix monologue: wait for replies, anchor task, close after confirm

**Ключевые проблемы решённые:**

- Бот говорил сам с собой (monologue) — починено prompt + VAD eagerness
- "Понял, сейчас я позвоню..." вместо прямого начала разговора — use greeting
- Role confusion ("я клиент" vs "я ассистент") — explicit role в prompt
- Stuttering при начале звонка — убраны duplicate firstTurnInstruction
- Mid-sentence cutoff — убран max_response_output_tokens

### Фаза 4: Telegram integration (22-26 фев)

- `7f97e3da3` — Proactive Telegram message после звонка
- `0676069ee` — LLM-generated concierge-style report вместо template summary
- `0f320f21f` — Calendar link в отчёте + fix duplicate messages
- `b46e612fe` — Natural first phrase + bootstrap SOUL.md
- `5fb6234aa` — Fix start-of-call stuttering (final)

**Текущее состояние:** Работает на проде. Voximplant provider. Бот звонит, бронирует, отправляет отчёт в Telegram.

---

## Calendar (Nabu Calendar)

### Фаза 1: MVP scaffold + ICS engine (28 фев)

- `77b0216b4` — Extension scaffold
- `9fa99a613` — ICS engine: fetcher, helpers, recurring, diff
- `20ec8781e` — Fix stateDir initialization
- `251d1fea0` — Docker fix для package.json

**Компоненты:**

- ICS Fetcher: HTTP + ETag + backoff + 5MB limit + timeout
- ICS Helpers: парсинг node-ical → CalendarEvent, фильтрация, free slots
- ICS Recurring: RRULE expansion + EXDATE handling
- ICS Diff: added/modified/removed events
- Store: per-user JSON config
- Ledger: incident FSM (new → sent → acked/dismissed/expired)
- 62 теста (helpers, recurring, diff)
- Tool `nabu_calendar`: setup, fetch, find_slots, handle_callback, status, disable
- Cron jobs: morning-check, evening-lookahead, periodic-sync, memory-consolidation

### Фаза 2: Баг-фиксы (28 фев)

- `39808ed1f` — D10: Timezone 3h offset (Google Calendar Z-suffix → node-ical Etc/UTC → `.setZone(fallbackTz)`)
- `39808ed1f` — Cron spam: промпты переписаны на SILENT-first
- `abf8fb5cd` — Удалён мёртвый Anthropic config

### Фаза 3: SKILL.md + проактивная модель (28 фев)

- `cd39005a9` — SKILL.md создан, plugin.json обновлён, cron промпты → tier 1 only

**Проактивная модель (3 класса):**

1. VIP changes — встреча с CEO/C-level появилась/отменилась/перенеслась
2. Important meeting approaching — board review, product review, стратегическая сессия
3. Suboptimal day — конкретные предложения что убрать/перенести и почему

**SILENT-first:** молчать по умолчанию, писать только при tier 1 событиях.

### Фаза 4: Codex review fixes (28 фев, не закоммичено)

5 фиксов по результатам Codex code review:

1. **SILENT → NO_REPLY** — OpenClaw cron runner подавляет delivery только на `NO_REPLY`. Бот отправлял буквальный текст "SILENT" пользователю.

2. **Дубликат skill** — workspace-level `skills/nabu-calendar/SKILL.md` имел высший приоритет и перебивал plugin SKILL.md (без проактивной модели). Workspace skill удалён, ценное содержимое мержнуто в plugin.

3. **Ledger не подключён** — `ledger.record()` никогда не вызывался. Добавлено:
   - `handleFetch` возвращает `ledger` поле (inCooldown, recentIncidentIds)
   - Новый action `record_incident` с dedup/cooldown
   - Cron промпты обновлены: проверяют ledger, вызывают record_incident

4. **setup/disable не чистят state** — Добавлен `fetcher.reset()` + `ledger.cleanup(0)` в setup. Disable чистит cache/ledger, возвращает `cronJobsToRemove[]`.

5. **Wrong tool name** — `calendar_fetch` → `nabu_calendar(action="fetch")` в callback plan instruction.

### Архитектурное решение: проактивность LLM vs алгоритмы

**Проблема:** Вся anti-spam логика (dedup, cooldown, daily cap) работает через LLM-дисциплину. LLM видит данные ledger в ответе fetch, но нет hard gate — может проигнорировать, забыть вызвать record_incident, спамить.

**ЧТО слать (содержание)** — LLM свобода правильна. VIP detection требует контекста, нюансов, это не закодируешь алгоритмом.

**КОГДА/СКОЛЬКО слать (anti-spam)** — нужны guardrails в коде. Для MVP текущий подход приемлем, но целевое решение:

- Вариант A: `send_proactive` action — тул сам проверяет dedup/cooldown/cap, LLM слушается ответа
- Вариант B: Delivery hook в OpenClaw (не существует пока)

**Статус:** Записано в backlog V1.1. Не блокирует текущий деплой.

---

## Bot Persona (SOUL.md)

- `1aefd55d8` 24 фев — Bootstrap SOUL.md into workspace on first deploy
- Nabu — персональный консьерж-ассистент
- Тон: деловой, уважительный, тёплый, лаконичный
- Форматирование под Telegram (тире, пустые строки, без markdown headers)

---

## iOS App

**Статус:** Scaffold, не в проде. Есть:

- `apps/LabotaCalendarPreview/` — SwiftUI mockups
- `apps/ios/Sources/Calendar/` — Calendar UI sketches
- `apps/LabotaCalendarPreview/NABU_TIER_SYSTEM.md` — 8-stage importance/movability pipeline (спека для V2)

**Когда:** V2 roadmap. Зависит от Calendar Backend API (PostgreSQL, REST).

---

## Документация

| Документ                              | Статус          | Описание                         |
| ------------------------------------- | --------------- | -------------------------------- |
| `workspace/SOUL.md`                   | Актуален        | Persona бота                     |
| `workspace/CALENDAR_PRD.md`           | Актуален (v0.2) | PRD: Telegram-first architecture |
| `workspace/CALENDAR_BOT_TOOLS.md`     | V1.1/V2 спека   | Расширенный набор тулов          |
| `workspace/CALENDAR_DATA_API.md`      | V2 спека        | Backend API + PostgreSQL         |
| `workspace/CALENDAR_MOCKUP_REVIEW.md` | Reference       | Обзор iOS mockups                |
| `apps/.../NABU_TIER_SYSTEM.md`        | V2 спека        | 8-stage importance pipeline      |

---

## Backlog

### P0: Прямо сейчас

- [ ] Закоммитить и задеплоить Codex-фиксы (calendar)
- [ ] Переподключить календарь на проде (пересоздать cron jobs с NO_REPLY)
- [ ] Тест на проде: проактивные + реактивные сценарии

### P1: V1.1 (следующий milestone)

**Calendar write-ops:**

- [ ] Google Calendar API OAuth
- [ ] ICS read + API write (stepping stone)
- [ ] create_event / update_event actions
- [ ] Confirm flow через TG inline-кнопки
- [ ] SKILL.md: снять ограничения 1-3, добавить write-ops guidance

**Anti-spam guardrails:**

- [ ] Hard gate: `send_proactive` action или delivery hook
- [ ] Hard daily cap на proactive messages
- [ ] E2E тест на proactive loop

**Event-driven проактивность:**

- [ ] Google events.watch (webhooks вместо 15-мин polling)
- [ ] Pub/Sub или публичный webhook endpoint

**Voice-call + Calendar:**

- [ ] После бронирования по звонку → предложить добавить в календарь
- [ ] Связка: voice-call report → create_event → confirm

### P2: V2

**iOS app:**

- [ ] SwiftUI app (визуализация дня, priority-лента)
- [ ] Calendar Backend API (PostgreSQL, REST, AI-ранжирование)
- [ ] EventKit sync (нативная iOS интеграция)
- [ ] Push notifications
- [ ] Формальный importance/movability scoring (NABU_TIER_SYSTEM.md)

**Autopilot (V3):**

- [ ] Бот сам создаёт/двигает события без подтверждения
- [ ] Правила пользователя (не до 09:00, не двигать HIGH, макс 2/день)
- [ ] Undo window 5 мин
- [ ] Audit log

---

## Файловая карта

### Voice-Call

| Файл                                         | Роль                         |
| -------------------------------------------- | ---------------------------- |
| `extensions/voice-call/index.ts`             | Main plugin                  |
| `extensions/voice-call/src/`                 | Providers, STT, TTS, manager |
| `extensions/voice-call/openclaw.plugin.json` | Plugin manifest              |

### Calendar

| Файл                                                     | Роль                                  |
| -------------------------------------------------------- | ------------------------------------- |
| `extensions/nabu-calendar/index.ts`                      | Main plugin: tool, service, cron jobs |
| `extensions/nabu-calendar/skills/nabu-calendar/SKILL.md` | LLM instructions                      |
| `extensions/nabu-calendar/openclaw.plugin.json`          | Plugin manifest                       |
| `extensions/nabu-calendar/src/ics-fetcher.ts`            | HTTP fetch + cache + backoff          |
| `extensions/nabu-calendar/src/ics-helpers.ts`            | Parse, filter, free slots             |
| `extensions/nabu-calendar/src/ics-recurring.ts`          | RRULE expansion                       |
| `extensions/nabu-calendar/src/ics-diff.ts`               | Diff engine                           |
| `extensions/nabu-calendar/src/store.ts`                  | Per-user config (JSON)                |
| `extensions/nabu-calendar/src/ledger.ts`                 | Incident FSM + dedup + cooldown       |
| `extensions/nabu-calendar/src/types.ts`                  | CalendarEvent, etc.                   |
| `extensions/nabu-calendar/src/config.ts`                 | Plugin config schema                  |

### Persona + Docs

| Файл                              | Роль              |
| --------------------------------- | ----------------- |
| `workspace/SOUL.md`               | Bot persona       |
| `workspace/CALENDAR_PRD.md`       | PRD v0.2          |
| `workspace/CALENDAR_BOT_TOOLS.md` | V1.1/V2 tool spec |
| `workspace/CALENDAR_DATA_API.md`  | V2 backend spec   |
| `workspace/WORKLOG.md`            | Этот файл         |
