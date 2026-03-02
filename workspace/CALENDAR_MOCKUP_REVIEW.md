# Ревью мокапов Labota Calendar

> Дата: 2026-02-26

---

## Оценка: 8.5/10

Мокапы точно передают Wispr Flow эстетику и покрывают все ключевые экраны MVP.
Ниже — конкретные улучшения для следующей итерации.

---

## 1. Дизайн-замечания

### 1.1 Онбординг: добавить progress bar

Wispr Flow использует тонкие линии-шаги сверху. На Welcome-экране его нет,
а на Connect Calendars — есть (две полоски). Нужна консистентность:

- Welcome = шаг 1/4 (одна полоска заполнена)
- Connect = шаг 2/4
- Permission = шаг 3/4
- Telegram link = шаг 4/4

### 1.2 Today screen: serif-заголовок "Your day" — ок, но

В PRD мы договорились на **русский язык** ("Ваш день", "среда, 26 февраля").
Мокапы на английском — это нормально для прототипа, но при реализации
нужно продумать, как serif-шрифт работает с кириллицей.
Рекомендация: протестировать EB Garamond / Playfair Display с русскими буквами.

### 1.3 Cloud Brief card: высота фиксирована (148pt)

Проблема: если AI-саммари длиннее 3 строк — обрежется.
Решение: сделать высоту dynamic, с минимумом 120pt.

### 1.4 Event cards: фиксированная высота (102pt)

Аналогично: длинные заголовки обрежутся.
Решение: .fixedSize(horizontal: false, vertical: true) + минимальная высота.

### 1.5 Event Detail: тёмная карточка — отлично, но

Нет кнопки "Override priority" (ручная смена важности).
В PRD это есть как фича: "swipe на карточке для override".
Предложение: добавить маленькую кнопку или long-press gesture.

---

## 2. Продуктовые замечания

### 2.1 Приоритеты: 4 уровня лучше, чем 3

Мокапы используют: Critical, Important, Strategic, Low.
Это лучше, чем мои high/medium/low в PRD.
→ Обновить PRD и Data Schema: priority = "critical" | "important" | "strategic" | "low"

### 2.2 Connect Calendars: статус "Connected" / "Not connected"

Хорошо. Но нужно добавить:

- Кол-во импортированных событий после подключения ("134 events synced")
- Возможность disconnect (кнопка или свайп)

### 2.3 Permission screen: "Read + Write access" vs "Keep read-only"

Отлично реализовано — две кнопки, lavender = рекомендуемый, outline = альтернатива.
Но в PRD есть 3 режима. Suggest-only отсутствует на экране.
Решение: либо убрать suggest-only из MVP, либо добавить третью опцию.
Рекомендация: убрать suggest-only из MVP (упростить). Два режима достаточно:

- Read-only (безопасный)
- Act with confirmation (рекомендуемый)

### 2.4 Telegram Control: missing "Audit log" кнопка

На экране Telegram Control нет ссылки на историю действий бота.
Это важно для доверия. Добавить внизу: "View action history →"

### 2.5 Missing screen: Settings / Profile

Нет экрана настроек:

- Время утреннего брифа
- Часовой пояс
- За сколько минут напоминать
- Кнопка "Отключить всё"
- Ссылка на Telegram бота
  Это можно добавить как 7-й экран.

---

## 3. Технические замечания к SwiftUI-коду

### 3.1 Палитра: Color из RGB — ок для прототипа

Для прода лучше Asset Catalog с Dark Mode support (даже если dark mode не в MVP,
лучше заложить инфраструктуру).

### 3.2 Шрифты: system serif ≠ EB Garamond

`.system(size: 56, weight: .medium, design: .serif)` даст New York (Apple serif).
Wispr Flow, судя по скриншотам, использует кастомный serif.
Для MVP New York подойдёт, но если хотим точную стилистику — нужен custom font.

### 3.3 Accessibility

Мокапы не имеют accessibility labels. Для MVP это ок,
но при реализации нужно добавить:

- VoiceOver labels для PriorityPill
- Dynamic Type support (минимум для body text)

### 3.4 Preview

`#Preview` есть — отлично. Для удобства можно добавить individual previews
для каждого экрана (WelcomeMockupScreen, TodayMockupScreen, etc.)

---

## 4. Alignment с PRD и API

### Совпадения (всё ок):

- ✅ EventKit как основа для доступа к календарям
- ✅ Cloud Brief = DayBrief из Data Schema
- ✅ Priority system (обновить PRD до 4 уровней)
- ✅ Consent modes (read-only, act-with-confirmation)
- ✅ Telegram как "command center"
- ✅ AI actions: smart reminders, suggest move, book table

### Расхождения (нужно синхронизировать):

- ⚠️ PRD: 3 приоритета → Мокапы: 4 приоритета → Обновить PRD
- ⚠️ PRD: 3 consent modes → Мокапы: 2 → Упростить PRD до 2
- ⚠️ PRD: русский язык UI → Мокапы: английский → Решить
- ⚠️ API: EventCategory (8 типов) → Мокапы: нет категорий → Категории внутреннее дело, ок

---

## 5. Рекомендуемые следующие шаги

1. **Открыть в Xcode** и валидировать визуально на iPhone 16 Pro simulator
2. **Решить язык UI**: английский (международный) vs русский (для тебя)
3. **Обновить PRD**: 4 приоритета, 2 consent modes, добавить Settings screen
4. **Добавить 7-й экран**: Settings/Profile
5. **Протестировать кириллицу** с serif-шрифтом (если русский UI)
6. **Начать Фазу 0**: Backend API skeleton + iOS project setup

---

## 6. Claude Prompt — отлично

Промпт для Claude чётко структурирован. Можно использовать для:

- Генерации альтернативных вариантов дизайна
- A/B тестирования визуальных направлений
- Генерации дополнительных экранов (Settings, Onboarding completion, Empty state)
