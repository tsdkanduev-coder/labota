# Labota (Nabu) — Work Log

> Рабочий журнал всего проекта: voice-call, calendar, бот, фронт, инфра.
> Обновляется по ходу работы.

---

## Проект: обзор

**Nabu** — персональный консьерж-ассистент в Telegram на платформе OpenClaw.

| Направление               | Статус               | Ключевые файлы                             |
| ------------------------- | -------------------- | ------------------------------------------ |
| **Voice-call** (звонки)   | Прод, Voximplant     | `extensions/voice-call/`                   |
| **Calendar** (расписание) | Прод, read-write     | `extensions/nabu-calendar/`                |
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

### Фаза 5: Prompt fix + Calendar link fix (2 мар)

- `ca3624d22` — **fix(voice-call): remove aggressive farewell rules from realtime prompt**
  - Убраны 3 строки промпта, заставлявшие бота трактовать любое "да"/"хорошо" как подтверждение и начинать прощание mid-conversation
  - Бот перестал прощаться преждевременно ✅
- `(pending)` — **fix(voice-call): fix Google Calendar URL encoding**
  - `URLSearchParams` кодировал `/` → `%2F` в `dates` и `ctz` параметрах
  - Google Calendar ожидает литеральные `/` — ссылка формировалась криво
  - Фикс: `params.toString().replace(/%2F/gi, "/")`

### Фаза 6: Multi-user hardening (3 мар)

- `c37a1b6c5` — Session scoping: `includeAllSessions` убран, всегда фильтрация по sessionKey
- `c37a1b6c5` — Daily call quota: 30 звонков/юзер/день (server-side guard)
- `82eafef4f` — Лимиты скорректированы: DAILY_CALL_LIMIT=30, maxConcurrentCalls=20

**Текущее состояние:** Работает на проде. Voximplant provider. Бот звонит, бронирует, отправляет отчёт в Telegram. Per-user quota и session isolation работают.

**Известные проблемы (backlog):**

- Бот иногда немного прерывается / перебивает собеседника. Причина: `semantic_vad` с `eagerness="high"` реагирует на паузы и междометия слишком быстро. Нужна работа над turn detection / eagerness tuning.

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

### Фаза 5: Google Calendar write-ops (28 фев — 3 мар)

- `a96920bd6` — OAuth flow + create/update/delete events через Google Calendar API
- `7a6302bb2` — Codex review: 5 фиксов
- `a7902d20d` / `6a24d3040` — 403 diagnostics + datetime validation
- `9e2934da2` — attendees (реальные email-инвайты) + place alias
- `eae630cc5` — voice-call → calendar integration after booking

**Компоненты:**

- OAuth: `auth` action → ссылка пользователю → callback → refresh token в store
- 2-step confirm flow: preview (HMAC confirmToken + idempotencyKey + expiresAt) → confirm
- `search_events` — поиск по имени/дате для update/delete
- `attendees` — массив email, Google Calendar отправляет инвайты
- `duplicateWarning`, `recurringWarning`, `pastEventWarning` — предупреждения в preview
- Ошибки: forbidden, confirmation_expired, rate_limit, needsReauth

### Фаза 6: Multi-user scaling (3 мар)

**Level 1 — Config patch (0 кода):**

- `c37a1b6c5` — Config в репо: `config/openclaw.json`
- `dmPolicy: "open"` + `allowFrom: ["*"]` — self-serve DM для новых юзеров
- `session.dmScope: "per-account-channel-peer"` — изоляция сессий
- `tools.deny` — заблокированы 13 опасных core tools (exec, process, sessions*\*, memory*\*)
- `OPENCLAW_CONFIG_PATH` env var в `render.yaml`

**Level 2 — Код:**

- `c37a1b6c5` — Per-user notes: `save_note`/`get_notes` actions (вместо глобального memory)
- `c37a1b6c5` — Cron idempotency: remove-then-create pattern
- `c37a1b6c5` — Onboarding section в SOUL.md
- Voice-call guards (см. Voice-Call → Фаза 6)

### Фаза 7: Prompt refactoring (3 мар)

- `90f3a3699` — SOUL.md: новый тон, рекомендации ресторанов (яндекс.карты, ультима, greatlist), авто-календарь после звонка
- `90f3a3699` — SKILL.md: полный перевод на русский, убраны противоречия (fix "4 раза переспрашивает"), переписана проактивная модель с примерами

**Проблема:** Бот просил пользователя добавить событие в календарь по 4 раза. Причина: 5 противоречащих сигналов в SKILL.md + SOUL.md. Починено через рефакторинг обоих файлов.

---

## Bot Persona (SOUL.md)

- `1aefd55d8` 24 фев — Bootstrap SOUL.md
- `90f3a3699` 3 мар — Полный рефакторинг
- Nabu — профессиональный консьерж-ассистент
- Тон: деловой, уважительный, тёплый, лаконичный
- Форматирование под Telegram (тире, пустые строки, без markdown headers)
- Рекомендации ресторанов: яндекс.карты, ультима, greatlist
- После звонка: авто-предложение добавить в календарь (одно подтверждение)

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

### Завершено

- [x] **P0: Деплой + верификация** — Calendar MVP задеплоен, тесты пройдены
- [x] **P2: Write-ops** — OAuth + create/update/delete + attendees + confirm flow + HMAC
- [x] **P4: Voice-call + Calendar** — SOUL.md: авто-предложение после звонка
- [x] **Multi-user scaling Level 1** — Config patch (dmPolicy, dmScope, tools.deny)
- [x] **Multi-user scaling Level 2** — Per-user notes, voice-call guards, cron idempotency
- [x] **Prompt refactoring** — SOUL.md + SKILL.md переписаны

### P1: Anti-spam guardrails

**Цель:** Перенести anti-spam из LLM-дисциплины в код.

- [ ] `send_proactive` action: тул проверяет dedup/cooldown/daily cap → возвращает ok/blocked
- [ ] Hard daily cap (конфигурируемый, default 5)
- [ ] Интеграционный тест: fetch with diff → record_incident → dedup check

### P2: Оптимизация затрат (Level 3)

**Цель:** Снизить $/юзер/день для 30+ пользователей.

- [ ] Pre-filter cron: пустой diff → NO_REPLY без вызова LLM
- [ ] Дешёвая модель для periodic-sync (GPT-4o-mini вместо GPT-5.1)
- [ ] Мониторинг: token counter + Sentry
- [ ] Google Calendar webhooks (заменить 15-мин polling)

### P3: iOS App (V2)

- [ ] SwiftUI app (визуализация дня, priority-лента)
- [ ] Calendar Backend API (PostgreSQL, REST, AI-ранжирование)
- [ ] EventKit sync (нативная iOS интеграция)
- [ ] Push notifications
- [ ] Формальный importance/movability scoring (NABU_TIER_SYSTEM.md)

### P4: Autopilot (V3)

- [ ] Бот сам создаёт/двигает события без подтверждения
- [ ] Правила пользователя (не до 09:00, не двигать HIGH, макс 2/день)
- [ ] Undo window 5 мин
- [ ] Audit log

---

## Инфраструктура

### Render (хостинг)

- Service ID: `srv-d67i0tur433s73f6t48g`
- URL: `https://openclaw-1zxd.onrender.com`
- Auto-deploy с main (+ ручной trigger через Render API)
- Persistent disk: `/data` — хранит `.openclaw/.env` (VOXIMPLANT_RULE_ID и др.)
- `OPENCLAW_CONFIG_PATH=/app/config/openclaw.json` — конфиг из репо

### Config management

- Конфиг в репо: `config/openclaw.json` (JSON5, comments allowed)
- Env vars: `${VAR}` syntax → OpenClaw `env-substitution.ts` подставляет
- **ВАЖНО:** Missing env var = `MissingEnvVarError` = fatal crash при старте
- **ВАЖНО:** Render PUT `/env-vars` ЗАМЕНЯЕТ весь массив (не upsert)
- Валидация: `dmPolicy: “open”` требует `allowFrom: [“*”]` — иначе crash

---

## Файловая карта

### Voice-Call

| Файл                                         | Роль                             |
| -------------------------------------------- | -------------------------------- |
| `extensions/voice-call/index.ts`             | Main plugin + daily quota guards |
| `extensions/voice-call/src/`                 | Providers, STT, TTS, manager     |
| `extensions/voice-call/openclaw.plugin.json` | Plugin manifest                  |

### Calendar

| Файл                                                     | Роль                                  |
| -------------------------------------------------------- | ------------------------------------- |
| `extensions/nabu-calendar/index.ts`                      | Main plugin: tool, service, cron jobs |
| `extensions/nabu-calendar/skills/nabu-calendar/SKILL.md` | LLM instructions (русский)            |
| `extensions/nabu-calendar/openclaw.plugin.json`          | Plugin manifest                       |
| `extensions/nabu-calendar/src/ics-fetcher.ts`            | HTTP fetch + cache + backoff          |
| `extensions/nabu-calendar/src/ics-helpers.ts`            | Parse, filter, free slots             |
| `extensions/nabu-calendar/src/ics-recurring.ts`          | RRULE expansion                       |
| `extensions/nabu-calendar/src/ics-diff.ts`               | Diff engine                           |
| `extensions/nabu-calendar/src/store.ts`                  | Per-user config + userNotes           |
| `extensions/nabu-calendar/src/ledger.ts`                 | Incident FSM + dedup + cooldown       |
| `extensions/nabu-calendar/src/types.ts`                  | CalendarEvent, NabuUserConfig         |
| `extensions/nabu-calendar/src/config.ts`                 | Plugin config schema                  |

### Config + Persona

| Файл                              | Роль                    |
| --------------------------------- | ----------------------- |
| `config/openclaw.json`            | OpenClaw config (JSON5) |
| `render.yaml`                     | Render deploy config    |
| `workspace/SOUL.md`               | Bot persona             |
| `workspace/WORKLOG.md`            | Этот файл               |
| `workspace/CALENDAR_PRD.md`       | PRD v0.2                |
| `workspace/CALENDAR_BOT_TOOLS.md` | V1.1/V2 tool spec       |
| `workspace/CALENDAR_DATA_API.md`  | V2 backend spec         |
