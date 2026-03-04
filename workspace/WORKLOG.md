# Labota (Nabu) — Work Log

> Рабочий журнал всего проекта: voice-call, calendar, бот, фронт, инфра.
> Обновляется по ходу работы.

---

## Проект: обзор

**Nabu** — персональный консьерж-ассистент в Telegram на платформе OpenClaw.

| Направление               | Статус                                         | Ключевые файлы                             |
| ------------------------- | ---------------------------------------------- | ------------------------------------------ |
| **Voice-call** (звонки)   | Прод, Voximplant                               | `extensions/voice-call/`                   |
| **Calendar** (расписание) | Прод, read-write (Google OAuth + Yandex OAuth) | `extensions/nabu-calendar/`                |
| **Bot persona** (SOUL)    | Прод                                           | `workspace/SOUL.md`                        |
| **iOS app**               | Scaffold, не в проде                           | `apps/LabotaCalendarPreview/`, `apps/ios/` |
| **Android/macOS**         | Scaffold                                       | `apps/android/`, `apps/macos/`             |

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

### Фаза 5: Multi-user hardening (3 марта)

- `c37a1b6c5` — Level 1 config + Level 2 code (daily call limits, includeAllSessions guard)
- `82eafef4f` — Daily call limit 3 → 30, restore maxConcurrentCalls to 20

### Фаза 6: Prompt refactoring (4 марта, НЕ ЗАКОММИЧЕНО)

**Статус: готово к ревью, не на main.**

Файлы с изменениями (в worktree `claude/flamboyant-jones`):

**`extensions/voice-call/index.ts`** — 4 изменения:

1. **Tool schema prompt description (строки 166-170)**: убрано "MUST include guest name, date/time, guests" → гибкое описание. Для бронирования рекомендует включать параметры, но разрешает любые звонки (инфо, вопросы и т.д.).

2. **Tool description (строки 624-631)**: та же логика — убрано жёсткое "never call without all three" → "for restaurant bookings try to include... for other calls — that's fine too".

3. **Call summary prompt (строка 915)**: "мы уточнили" → "я уточнил". НЕ "мы".

4. **Call summary prompt (строки 922, 929)**: "Остаёмся в вашем распоряжении" → "Если нужна помощь — обращайтесь" + пример summary обновлён.

### Фаза 7: Realtime audio pipeline bug (4 марта, АНАЛИЗ)

**Симптомы:**

- Бот начинает говорить через 10+ секунд после поднятия трубки
- Бот сам себе подтверждает бронирование

**Root cause найден:**

`media-stream.ts` строка 493: `sttSession.connect()` вызывается **БЕЗ await** (fire-and-forget). OpenAI Realtime WebSocket подключается в фоне, а `sendAudio()` (строка 509) проверяет `if (!this.connected)` и **молча дропает аудио**.

**Timeline бага:**

```
t=0s    initiateCall() → Voximplant звонит
t=5-15s Телефон звонит (OpenAI НЕ подключается — ждёт media stream)
t=15s   Callee берёт трубку → media stream → createSession()
t=15s   sttSession.connect() запущен без await, OpenAI WS подключается
t=15-18s Callee говорит "алло?", "да, слушаю" — аудио ДРОПАЕТСЯ (connected=false)
t=18s   OpenAI готов, аудио начинает проходить
t=20s   Бот наконец начинает говорить
t=20s+  Callee отвечает "да" (на сам вопрос бота) → бот принимает за подтверждение
```

**Дополнительный фактор:** в коммите `ca3624d22` (2 марта) удалены anti-monologue правила из промпта ("после каждой реплики жди ответа"), потому что они вызывали другой баг (преждевременное прощание на любое "да"). Без этих правил + задержка аудио = самоподтверждение.

**Предлагаемый фикс:**

1. **Pre-warm OpenAI сессию** при `initiateCall()`, а не при подключении media stream. Пока телефон звонит (5-15с), OpenAI уже подключён и ждёт. При подключении media — аудио сразу идёт в готовую сессию, 0 задержка.
2. **Мягкое anti-loop правило** в промпте (не агрессивное как раньше): "После своей реплики жди ответа. Не подтверждай бронь пока собеседник явно не подтвердил."
3. **VAD eagerness** — рассмотреть снижение с "high" до "medium".

**Текущее состояние:** Работает на проде. Voximplant provider. Бот звонит, бронирует, отправляет отчёт в Telegram. Есть баг с задержкой первых секунд звонка (Фаза 7).

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

### Фаза 5: Yandex Calendar OAuth (5 марта)

- `a4b977fe8` — Yandex Calendar OAuth flow + schema (PR-1, merged to main)
- OAuth 2.0 + PKCE, callback handler, token storage в per-user store
- Schema: `activeWriteProvider` field ("google" | "yandex"), dual provider support
- `yandex-auth.ts`: buildAuthUrl, exchangeCode, refreshToken, revokeToken
- 13 тестов для Yandex auth flow
- **CRUD пока только Google** — Yandex CalDAV write ops = следующий шаг (PR-2)

### Фаза 6: SKILL.md v2 — дистилляция логики анализа (5 марта)

- `a371c2312` — Полная переработка SKILL.md (merged to main)
- Источник: `NABU_TIER_SYSTEM.md` (1230 строк, спека для нативного приложения)
- Весь файл переведён на русский (~380 строк, было 258 mixed RU/EN)

**Новые секции проактивного анализа:**

1. **Оценка важности событий** — 3 уровня сигналов: dominant (VIP, внешние, hard constraints), strong (организатор, confirmed, one-off), weak (количество участников, ключевые слова). Data availability guard: нет данных ≠ низкая важность.

2. **VIP-детекция** — минимум 2 сигнала для VIP-статуса. Сигналы: по названию (1:1 + review, Board), по email (ceo@, cto@), по паттерну встреч. Memory: гипотеза после 3-й встречи.

3. **Типы инцидентов** — 5 типов: overlap, prep_risk, commute_risk, overload, external_change. Commute risk с подробной логикой буфера между оффлайн-встречами.

4. **Фреймворк решений** — actionability gate (писать ТОЛЬКО если есть конкретное действие). Что можно убрать (recurring sync, optional), что нельзя трогать (VIP, внешние, hard constraint, оффлайн в ближайшие 2 часа).

5. **Day-level reasoning** — таблица реакций по ситуациям (1 инцидент → коротко, 3+ → комплексный план, 8-11 без конфликтов → NO_REPLY).

6. **Расширенный NO_REPLY** — конкретные примеры когда молчать (standup сдвинулся на 15 мин, описание обновилось, all-day FYI, два LOW пересекаются).

**Точечные фиксы из Codex-ревью:**

- Dual provider: при двух провайдерах — спроси у пользователя
- Confirm same provider: подтверждение в том же провайдере что и preview
- search_events для eventId: никогда не конструируй ID вручную
- htmlLink + meetLink: показывай оба после создания
- Recurring fallback: если series не поддерживается — предложи instance
- Тон: до 8 строк для плана оптимизации (было жёсткое 2-4)
- Юмор: только если пользователь неформальный
- Memory: 1-3 наблюдения, не спамить
- NO_REPLY: ровно строка `NO_REPLY` без дополнительного текста

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
- `90f3a3699` 4 мар — allowFrom fix + SOUL.md/SKILL.md refactor (deployed)
- Nabu — персональный консьерж-ассистент
- Тон: деловой, уважительный, тёплый, лаконичный
- Форматирование под Telegram (тире, пустые строки, без markdown headers)

### Prompt refactoring (4 марта, НЕ ЗАКОММИЧЕНО)

**`workspace/SOUL.md`** — 5 изменений:

1. **Анти-мета блок**: "Ты уже полностью настроен. Не предлагай настроить себя. Имя — Nabu, не обсуждается." Без этого LLM при /start "просыпается" и предлагает выбрать имя.

2. **"Я" не "мы"**: "Пиши от первого лица единственного числа: «я нашёл», «забронировал»." Без явного правила LLM использует "мы" (особенно из-за groups systemPrompt).

3. **Строгий онбординг**: "отправь ИМЕННО ЭТО сообщение" + 4 правила НЕ (не придумывай, не спрашивай имя, не предлагай настройку). Было "адаптируй под контекст" → LLM выдумывал "Мы только что проснулись в этом пространстве".

4. **Опечатка**: "атморсфера" → "атмосфера".

5. **Пустой заголовок**: удалён `## Сценарии` (мусор).

**`config/openclaw.json`** — 1 изменение:

Groups systemPrompt: 14 строк инструкций с "мы подобрали" → 1 строка: "Ты — Nabu. Следуй SOUL.md. Отвечай когда упомянут. Будь краток."

**Контекст:** groups systemPrompt применяется ТОЛЬКО в групповых чатах. DM использует только SOUL.md. Подтверждено кодом: `bot-message-context.ts` ~строка 637.

### Аудит промпт-пайплайна (4 марта)

Все места где LLM получает инструкции:

| Место                            | Тип                  | Вердикт                                                     |
| -------------------------------- | -------------------- | ----------------------------------------------------------- |
| SOUL.md → DM system prompt       | Persona + rules      | Исправлен (см. выше)                                        |
| config groups systemPrompt       | Group chat only      | Исправлен (см. выше)                                        |
| voice_call tool description      | Tool schema          | Исправлен — разрешены любые звонки                          |
| voice_call prompt field          | TypeBox schema       | Исправлен — гибкое описание                                 |
| voice_call summary prompt        | generateLlmSummary() | Исправлен — "я" не "мы"                                     |
| voice_call realtime instructions | webhook.ts:270-294   | Примеры с обеих сторон диалога — не трогаем (не root cause) |
| config assistantInstructions     | Realtime voice       | OK — нейтральный                                            |
| SKILL.md calendar                | Calendar tool        | OK — не трогаем                                             |
| tools.deny list                  | Security             | OK                                                          |

---

## iOS App

**Статус:** Scaffold, не в проде. Есть:

- `apps/LabotaCalendarPreview/` — SwiftUI mockups
- `apps/ios/Sources/Calendar/` — Calendar UI sketches
- `apps/LabotaCalendarPreview/NABU_TIER_SYSTEM.md` — 8-stage importance/movability pipeline (спека для V2)

**Когда:** V2 roadmap. Зависит от Calendar Backend API (PostgreSQL, REST).

---

## Документация

| Документ                                         | Статус           | Описание                                    |
| ------------------------------------------------ | ---------------- | ------------------------------------------- |
| `workspace/SOUL.md`                              | Актуален         | Persona бота                                |
| `workspace/CALENDAR_PRD.md`                      | Актуален (v0.2)  | PRD: Telegram-first architecture            |
| `workspace/CALENDAR_BOT_TOOLS.md`                | V1.1/V2 спека    | Расширенный набор тулов                     |
| `workspace/CALENDAR_DATA_API.md`                 | V2 спека         | Backend API + PostgreSQL                    |
| `workspace/CALENDAR_MOCKUP_REVIEW.md`            | Reference        | Обзор iOS mockups                           |
| `apps/LabotaCalendarPreview/NABU_TIER_SYSTEM.md` | V2 спека (в git) | 9-stage pipeline, two-score priority, 60 KB |

---

## Infra

- **Render:** service `srv-d67i0tur433s73f6t48g`, owner `tea-d67i047pm1nc7387sd2g`
- **Config:** `OPENCLAW_CONFIG_PATH=/app/config/openclaw.json` (JSON5, в git)
- **Voximplant:** account 10277772, service account `f4c88d2d-161c-4c08-9127-0135181746d0` (Nabu - Recovery), rule 8315125
- **Voximplant key recovery (4 марта):** приватный ключ был повреждён при PUT env-vars восстановлении (DER +1 байт). Пересоздан service account, обновлены KEY_ID + PRIVATE_KEY_B64 в Render.
- **ВАЖНО:** Render PUT `/env-vars` заменяет ВСЕ переменные. Использовать только Dashboard или GET → modify → PUT с верификацией.

## Backlog

### P0: Прямо сейчас

- [x] Закоммитить и задеплоить Codex-фиксы (calendar) — `ab167c3`, Render live 28 фев 22:05
- [x] Multi-user Level 1 config (dmPolicy, dmScope, tools.deny) — `c37a1b6c5`
- [x] Multi-user Level 2 code (call quotas, session guards) — `c37a1b6c5`
- [x] allowFrom fix — `90f3a3699`
- [x] Voximplant key recovery — новый service account `f4c88d2d`
- [x] Yandex Calendar OAuth flow + schema (PR-1) — `a4b977fe8`, 5 марта
- [x] SKILL.md v2: дистилляция логики анализа из NABU_TIER_SYSTEM.md — `a371c2312`, 5 марта
- [ ] **Закоммитить промпт-фиксы** (SOUL.md, config, voice-call) — в worktree, ждёт ревью
- [ ] **Voice-call: pre-warm OpenAI сессию** при initiateCall (Фаза 7) — root cause задержки 10с

### P1: Следующее

- [ ] **Yandex Calendar CRUD** (PR-2) — CalDAV write ops (create/update/delete)
- [ ] **SKILL.md Фаза B** — обновить cron prompts в index.ts (после 2-3 дней наблюдения за v2)
- [ ] Voice-call: мягкое anti-loop правило (без агрессивных farewell)
- [ ] Voice-call: рассмотреть VAD eagerness medium
- [ ] Voice-call: проверить echo cancellation в Voximplant
- [ ] Anti-spam guardrails (hard gate для proactive messages)
- [ ] Google events.watch (webhooks вместо polling)
- [ ] Pre-filter cron: пустой diff → skip LLM (50% экономии)
- [ ] Дешёвая модель для cron (GPT-4o-mini)

### P2: V2

- [ ] iOS app (SwiftUI, Calendar Backend API)
- [ ] Autopilot mode (бот двигает события без подтверждения)
- [ ] Мониторинг: token counter + Sentry

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
| `extensions/nabu-calendar/src/yandex-auth.ts`            | Yandex OAuth 2.0 + PKCE               |
| `extensions/nabu-calendar/src/types.ts`                  | CalendarEvent, etc.                   |
| `extensions/nabu-calendar/src/config.ts`                 | Plugin config schema                  |

### Persona + Docs + Config

| Файл                              | Роль                                            |
| --------------------------------- | ----------------------------------------------- |
| `workspace/SOUL.md`               | Bot persona (DM system prompt)                  |
| `config/openclaw.json`            | Platform config (groups prompt, tools, plugins) |
| `workspace/CALENDAR_PRD.md`       | PRD v0.2                                        |
| `workspace/CALENDAR_BOT_TOOLS.md` | V1.1/V2 tool spec                               |
| `workspace/CALENDAR_DATA_API.md`  | V2 backend spec                                 |
| `workspace/WORKLOG.md`            | Этот файл                                       |
