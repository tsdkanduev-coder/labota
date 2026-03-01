# Nabu Proactive Calendar Intelligence — Architecture Specification v3.0

> **Status**: Final design, approved for implementation.
> **Last updated**: 2025-07-14
> **Authors**: Human (product), Claude (architecture), Codex (review & hardening)
> **Related code**: `Sources/LabotaCalendarMockups.swift` (UI mockups)

---

## Table of Contents

1. [System Purpose](#1-system-purpose)
2. [Pipeline Architecture](#2-pipeline-architecture)
3. [Trigger Layer](#3-trigger-layer)
4. [Event Priority Classification](#4-event-priority-classification)
5. [Incident Detection](#5-incident-detection)
6. [Day Context Layer](#6-day-context-layer)
7. [Decision Packages](#7-decision-packages)
8. [Authorization](#8-authorization)
9. [Tier Classification](#9-tier-classification)
10. [Message Generation (NabuBrief)](#10-message-generation-nabubrief)
11. [Execution](#11-execution)
12. [Resolution](#12-resolution)
13. [Delivery Policy](#13-delivery-policy)
14. [Policy Layer](#14-policy-layer)
15. [Observability](#15-observability)
16. [Rollout Plan](#16-rollout-plan)
17. [Mockup Mapping](#17-mockup-mapping)
18. [Design Decisions Log](#18-design-decisions-log)
19. [Edge Cases & Test Scenarios](#19-edge-cases--test-scenarios)
20. [Glossary](#20-glossary)

---

## 1. System Purpose

Nabu is a calendar AI assistant. It analyzes a user's calendar day and surfaces **one proactive brief** — a natural-language message telling the user what needs attention and what Nabu can do about it.

The system decides three things:
1. **What to say** — the headline message
2. **How urgent it is** — Tier 1 (plan), Tier 2 (decision), Tier 3 (info)
3. **What action to propose** — from "just FYI" to "apply this restructuring plan"

### Core design principles
- **Minimalism**: The message IS the product. No icons, no stats, no clutter.
- **One brief at a time**: Never overwhelm. Highest priority only.
- **Decision-centric**: Tiers are determined by how many user approvals are needed.
- **Safe by default**: Never auto-mutate important meetings without explicit permission.

---

## 2. Pipeline Architecture

Every proactive action follows one immutable 8-stage pipeline:

```
trigger → detect → day_context → propose → authorize → tier → message → execute → resolve
```

**This is the system invariant. If a rule cannot fit this pipeline, reject it.**

| Stage | Input | Output | Description |
|---|---|---|---|
| **Trigger** | Time, calendar webhooks, app state | Pipeline invocation | WHEN to run the pipeline |
| **Detect** | Calendar state + event priorities | `Incident[]` | WHAT issues exist |
| **Day Context** | All incidents for the day | `DaySummary` | HOW the day looks overall |
| **Propose** | Incidents + context + policy | `DecisionPackage[]` | WHAT to do about it |
| **Authorize** | Packages + policy | Tagged packages | WHO needs to approve |
| **Tier** | Authorized packages + control vars | Tier 1/2/3 | HOW urgent is it |
| **Message** | Tier + incidents + packages | `NabuBrief` | WHAT to tell the user |
| **Execute** | User response + calendar state | Mutations applied (or not) | DO the thing |
| **Resolve** | Execution result + user action | Resolution record | REMEMBER what happened |

### Pipeline flow diagram

```
┌─────────────────────────────────────────────────────┐
│                    TRIGGER LAYER                     │
│  app_open | calendar_change | time_proximity |       │
│  scheduled_scan (morning 7:30, midday 12:00)         │
└──────────────────────┬──────────────────────────────┘
                       ↓
┌──────────────────────┴──────────────────────────────┐
│                      DETECT                          │
│  Calendar state + event priorities →                 │
│  Incident[] (overlap, prep_risk, commute_risk,       │
│              overload, external_change)               │
│  Filter: check resolve_log, skip suppressed          │
└──────────────────────┬──────────────────────────────┘
                       ↓
┌──────────────────────┴──────────────────────────────┐
│                   DAY CONTEXT                        │
│  Aggregate incidents into day_summary                │
│  total_meetings, total_incidents, time_pressure      │
│  If total_decision_count >= 3 → hint: bundle as plan │
│  If total_incidents >= 4 + any tier >= 2 → hint: T1  │
└──────────────────────┬──────────────────────────────┘
                       ↓
┌──────────────────────┴──────────────────────────────┐
│                     PROPOSE                          │
│  For each incident: generate DecisionPackage         │
│  FILTER: no mutations on hard_locked events          │
│  Consider day_context hints for bundling strategy    │
│  Output: DecisionPackage[]                           │
└──────────────────────┬──────────────────────────────┘
                       ↓
┌──────────────────────┴──────────────────────────────┐
│                    AUTHORIZE                         │
│  Per-package confidence gating:                      │
│    conf < 0.6 → downgrade to INFO                    │
│    conf 0.6-0.8 → max SOFT                           │
│    conf >= 0.8 → full capability                     │
│  Apply policy (auto_soft, never_auto_decline, etc.)  │
│  Tag each package: requires_approval = true/false    │
└──────────────────────┬──────────────────────────────┘
                       ↓
┌──────────────────────┴──────────────────────────────┐
│                      TIER                            │
│  Count decision_count, check interdependent,         │
│  check blast_radius, check forced overrides          │
│  + day_context force_tier1 if applicable             │
│  Output: Tier 1, 2, or 3                             │
└──────────────────────┬──────────────────────────────┘
                       ↓
┌──────────────────────┴──────────────────────────────┐
│                    MESSAGE                           │
│  Generate NabuBrief:                                 │
│    headline (natural language)                        │
│    severity (.info / .warning / .urgent)              │
│    actionLabel / dismissLabel                        │
│  Preemption: if new tier > current active → replace  │
└──────────────────────┬──────────────────────────────┘
                       ↓
┌──────────────────────┴──────────────────────────────┐
│                    EXECUTE                           │
│  User clicks action →                                │
│  Optimistic lock: verify plan_revision_id            │
│  Atomic per-package execution                        │
│  Idempotency key prevents double-apply               │
│  Partial failure → stop + re-plan + new confirm      │
└──────────────────────┬──────────────────────────────┘
                       ↓
┌──────────────────────┴──────────────────────────────┐
│                    RESOLVE                           │
│  Record user_action:                                 │
│    applied → remove incident from active             │
│    dismissed → cooldown 90 min                       │
│    kept_as_is → suppress for rest of day             │
│    expired → remove silently                         │
│  Feed back into detect (filter suppressed)           │
│  Feed into observability metrics                     │
└─────────────────────────────────────────────────────┘
```

---

## 3. Trigger Layer

The pipeline needs to know WHEN to run. Without triggers, it's a dead function.

### Trigger types

| Trigger | When it fires | What it does |
|---|---|---|
| `app_open` | User opens Nabu app | Full pipeline run for today |
| `calendar_change` | Any calendar event created/modified/deleted (webhook or polling) | Re-run detect for affected time window |
| `time_proximity` | X minutes before a meeting involved in an incident | Re-run pipeline, check if brief needs update |
| `scheduled_scan` | Configurable times (default: 7:30 AM, 12:00 PM) | Full pipeline run for today |

### Time proximity defaults

| Tier | Notify before affected meeting |
|---|---|
| Tier 1 | Morning scan + every calendar_change |
| Tier 2 | 60 min before affected meeting |
| Tier 3 | 30 min before (commute), morning scan (tips) |

### Important constraints
- Triggers respect `working_hours` policy — no triggers outside working hours.
- `calendar_change` triggers have a 2-minute debounce to avoid storm on batch updates.
- `scheduled_scan` is the primary mechanism for "proactive morning brief."

---

## 4. Event Priority Classification

Priority answers: **"If this meeting conflicts with another, how hard should Nabu fight to keep it?"**

### 4.1 Architecture: Two Independent Scores

Every calendar event gets two scores, computed independently:

```
Calendar Event (from API)
    ↓
[6 API signals + LLM VIP inference]
    ↓
importance_score (0.0 - 1.0)  +  movability_score (0.0 - 1.0)
    ↓
composite = importance * 0.75 + movability * 0.25
    ↓
priority_class: HIGH (>= 0.45) / MEDIUM (0.20-0.44) / LOW (< 0.20)
    ↓
[Sanity cap: HIGH <= 30% of day's events]
```

**Why two scores, not one:**
A single "priority" axis conflates two different questions:
- "How important is this meeting?" (importance)
- "How hard is it to reschedule?" (movability)

These are independent. A 1:1 with your CEO is high importance + low movability (just 2 people, easy to move — but you'd NEVER want to). A 30-person all-hands is low importance to you + high movability (impossible to reschedule — but your absence doesn't matter).

**Why importance weighs 0.75 and movability 0.25:**
Importance dominates. If a meeting is critical, you protect it regardless of how easy it is to move. Movability is a logistical tiebreaker, not the primary axis.

### 4.2 Importance Score (0.0 - 1.0)

**"If this meeting is cancelled entirely, what's the damage?"**

| Signal | Weight | Source | Reliability |
|---|---|---|---|
| **VIP attendee** (LLM-inferred + user-tagged) | **+0.40** | LLM inference, user tags, org chart (V2) | Variable (see VIP section) |
| **organizer = self** | +0.20 | Calendar API `organizer.email` | High |
| **required attendee + accepted** | +0.15 | Calendar API `attendees[self].optional` + `responseStatus` | High |
| **one-off (not recurring)** | +0.05 | Calendar API `recurrence` | High |
| **external attendees** | +0.05 | Email domain comparison | High |
| **attendee count** | +0.02/person, cap +0.10 | Calendar API `attendees.length` | High |

```
importance = clamp(0.0, 1.0,
    (has_vip ? 0.40 * vip_confidence : 0.0)
  + (organizer_self ? 0.20 : 0.0)
  + (required_and_accepted ? 0.15 : 0.0)
  + (is_one_off ? 0.05 : 0.0)
  + (has_external ? 0.05 : 0.0)
  + min(0.10, attendee_count * 0.02)
)
```

**Design decisions on signal weights:**

- **VIP (+0.40)** is the dominant signal. Meetings with your CEO, your boss, key clients — these are the meetings you never skip. Everything else is secondary.
- **organizer = self (+0.20)** — you called this meeting. People are coming for you. Cancelling it reflects poorly on you.
- **required + accepted (+0.15)** — you committed to being there. Breaking commitment has social cost.
- **one-off (+0.05)** — weak signal. Many one-offs are casual. But a one-off can't be "skipped to next week."
- **external (+0.05)** — weak signal. External vendor syncs aren't automatically important. But there's a slight coordination cost.
- **attendee count (+0.02/person, cap +0.10)** — micro-signal. 30 people does NOT mean 30x importance. You're one of 30. Cap prevents large meetings from dominating.

**Signals intentionally EXCLUDED from V1:**
- Title keywords ("strategy", "review", "board") — too many false positives. "Strategy lunch" ≠ "Board strategy review."
- "Created in last 24h" heuristic — not reliably correlated with importance.
- Meeting duration — a 2-hour meeting can be important or a waste. Duration doesn't predict.

### 4.3 Movability Score (0.0 - 1.0)

**"How hard is it to find another time?"**

Higher score = HARDER to move.

| Signal | Weight | Source | Reliability |
|---|---|---|---|
| **VIP attendee** | **+0.35** | Same as importance | Variable |
| **external attendees** | +0.20 | Domain check | High |
| **has physical location** | +0.15 | Calendar API `location` | High |
| **one-off (not recurring)** | +0.075 | Calendar API `recurrence` | High |
| **attendee count** | +0.04/person, cap +0.20 | Calendar API | High |
| **all attendees accepted** | +0.10 | Calendar API `responseStatus` | High |
| **hard_lock (user flag)** | override → 1.0 | Nabu settings | Absolute |

```
if hard_lock: movability = 1.0
else: movability = clamp(0.0, 1.0,
    (has_vip ? 0.35 * vip_confidence : 0.0)
  + (has_external ? 0.20 : 0.0)
  + (has_physical_location ? 0.15 : 0.0)
  + (is_one_off ? 0.075 : 0.0)
  + min(0.20, attendee_count * 0.04)
  + (all_accepted ? 0.10 : 0.0)
)
```

**Why movability signals differ from importance:**
- **VIP (+0.35)** — you don't ask the CEO to move. High movability cost.
- **external (+0.20)** — you can't see their calendar. Rescheduling requires back-and-forth. This is a LOGISTICS weight, not an importance weight (that's why it's +0.20 here but only +0.05 in importance).
- **physical location (+0.15)** — room booked, people traveling physically. Can't just move to another slot without re-booking.
- **attendee count (+0.04/person, cap +0.20)** — more people = more calendars to coordinate. Finding a new time for 5+ people is genuinely hard.
- **all accepted (+0.10)** — everyone confirmed. Moving it now costs trust.

### 4.4 VIP Detection

VIP is the **most important signal** in the entire system. It appears in both scores with the highest weights (+0.40 importance, +0.35 movability).

**Who is VIP:**
- CEO, C-level executives, board members
- User's direct manager
- Skip-level manager (boss's boss)
- People 1-2 grades above the user in the org
- Key clients (major accounts, strategic partners)
- Key external stakeholders (investors, advisors)
- Anyone the user has explicitly tagged as VIP

**VIP is NOT just a user tag. LLM infers VIP status, user calibrates.**

#### Three sources of VIP detection

| Source | Confidence | Available when |
|---|---|---|
| **User-tagged** | 1.0 (absolute) | V1 — user manually marks contacts |
| **LLM inference** | 0.6 - 0.8 | V1 — from title, context, attendee patterns |
| **Org chart / directory** | 0.9 | V2 — LDAP, BambooHR, etc. |
| **Behavioral learning** | 0.8 - 0.9 | V2 — user always protects this person's meetings |

#### LLM inference signals for VIP
- Meeting title contains person's name + "review", "update", "sync" (suggests reporting relationship)
- Attendee email pattern (ceo@, cto@, vp-*, c-suite naming conventions)
- Person appears in few but long, one-off meetings (executive pattern)
- Meeting description mentions deliverables, approvals, sign-offs for this person

#### VIP governance rules (critical for safety)

```
When LLM infers VIP with confidence < 0.9 AND user has not confirmed/denied:
  1. Apply weight at reduced strength: vip_weight * vip_confidence
  2. After 3rd meeting with this person: prompt user
     "I noticed you have regular meetings with [Name]. Mark as VIP?"
  3. If confirmed: vip_confidence = 1.0 (permanent)
  4. If denied: vip_flag = false for this person (stop inferring)
  5. Never ask more than once per person
```

**Why 3rd meeting threshold:** Don't ask on first meeting — not enough pattern. By 3rd meeting, there's a real relationship signal.

#### Confidence scaling

When VIP confidence < 1.0, both importance and movability weights are scaled:
```
importance_vip_contribution = 0.40 * vip_confidence
movability_vip_contribution = 0.35 * vip_confidence
```

Example: LLM infers VIP with 0.7 confidence:
- importance gets +0.28 instead of +0.40
- movability gets +0.245 instead of +0.35

### 4.5 Priority Class Computation

```
composite = importance * 0.75 + movability * 0.25
```

| Composite Score | Priority Class |
|---|---|
| >= 0.45 | **HIGH** |
| 0.20 - 0.44 | **MEDIUM** |
| < 0.20 | **LOW** |

```python
def priority_class(importance: float, movability: float) -> str:
    composite = importance * 0.75 + movability * 0.25
    if composite >= 0.45:
        return "HIGH"
    elif composite >= 0.20:
        return "MEDIUM"
    else:
        return "LOW"
```

### 4.6 Hard Constraints (Separate from Priority)

Binary flags that bypass the scoring system entirely:

| Flag | Source | Effect |
|---|---|---|
| `hard_lock` | User explicitly set in Nabu | `movability = 1.0`, proposer NEVER generates mutations for this event |
| `non_negotiable` | Auto-detected (OOO, medical) or user-set | Same as hard_lock |

**Critical architecture rule:** hard_lock is NOT a signal in the scoring formula. It is a **pre-filter in the propose stage**. The proposer checks hard_lock BEFORE generating any mutations. Locked events are immovable walls — the plan is built AROUND them.

### 4.7 Distribution Sanity Cap

If HIGH > 30% of events in a day → auto-downgrade the weakest HIGH events (lowest composite score) to MEDIUM until HIGH <= 30%.

```python
events_high = sorted(
    [e for e in day_events if e.priority == "HIGH"],
    key=lambda e: e.composite_score
)
while len(events_high) / len(day_events) > 0.30:
    weakest = events_high.pop(0)
    weakest.priority = "MEDIUM"
```

**Why this matters:** Without the cap, an executive with 15 meetings (8 external) would have 53% HIGH. The tier engine would be in Tier 1 every single day. The cap forces differentiation.

### 4.8 Validation Table

| Meeting | importance | movability | composite | Class | Reasoning |
|---|---|---|---|---|---|
| CEO quarterly (VIP, organized, req, 8 ppl, one-off, physical) | 0.96 | 0.88 | 0.94 | **HIGH** | Obviously critical |
| 1:1 with direct manager (VIP, required, accepted, 2 ppl) | 0.59 | 0.43 | 0.55 | **HIGH** | You don't skip manager 1:1s |
| Client QBR (VIP 0.7 conf, external, organized, 4 ppl, one-off) | 0.81 | 0.78 | 0.81 | **HIGH** | Key client, hard to move |
| Weekly standup (5 ppl, required, accepted, recurring) | 0.25 | 0.30 | 0.26 | **MEDIUM** | Team ritual, movable |
| Vendor sync (external, 2 ppl, recurring, required) | 0.24 | 0.28 | 0.25 | **MEDIUM** | Not HIGH just because external |
| All-hands (30 ppl, required, recurring) | 0.25 | 0.30 | 0.26 | **MEDIUM** | 30 people != important for you |
| Coffee chat (2 ppl, organized, recurring) | 0.24 | 0.08 | 0.20 | **MEDIUM** | Borderline, flexible |
| Optional FYI meeting (10 ppl, optional) | 0.10 | 0.30 | 0.15 | **LOW** | You're optional, doesn't matter |
| Unresponded invite (3 ppl, no RSVP) | 0.06 | 0.12 | 0.07 | **LOW** | Haven't committed |
| Doctor appointment (hard_lock) | 0.00 | 1.00 | 0.25 | **MEDIUM** | Protected logistically |

### 4.9 Confidence for Priority Classification

Priority confidence depends on which signals were available:

| Available signals | Confidence |
|---|---|
| Only attendee count (no RSVP, no domain check) | 0.4 - 0.5 |
| + RSVP + organizer + required/optional | 0.6 - 0.7 |
| + domain check + recurrence (full API) | 0.7 - 0.85 |
| + VIP tags or hard_locks from user | 0.85 - 0.95 |
| + behavioral history (V2) | 0.95+ |

With 6 standard API signals, most events reach **0.8 confidence** immediately after calendar connect. The system operates at full capability from day one for most users.

### 4.10 Learning Loop (V2)

After 2+ weeks of usage, Nabu learns from user behavior:

| User action | What Nabu learns |
|---|---|
| Always protects meetings with person X | X is effectively VIP → boost |
| Always dismisses briefs about meeting Y | Y is less important → lower weight |
| Manually reschedules meeting Z every week | Z is flexible → lower movability |
| Never moves meetings before 10am | Morning = sacred → increase priority for AM |
| Accepts every plan that moves recurring standup | Standup is flexible → lower priority |

### 4.11 Expected Priority Distribution

For a typical knowledge worker:

| Priority | Expected % | If outside range |
|---|---|---|
| HIGH | 10-20% | > 30% → sanity cap triggers |
| MEDIUM | 40-50% | Normal |
| LOW | 30-50% | < 20% → system may be over-classifying |

---

## 5. Incident Detection

Five canonical incident types. No more, no less.

| Type | Trigger | Example |
|---|---|---|
| `overlap` | 2+ events in same time slot | "Design review and CEO prep both at 14:00" |
| `prep_risk` | Important meeting needs prep, slot occupied | "CEO review at 15:00, but 14:00-15:00 has 2 meetings" |
| `commute_risk` | Travel time needed, insufficient buffer | "Lunch at 13:00 needs 40 min commute, no gap" |
| `overload` | Day exceeds meeting density threshold | "14 meetings today" |
| `external_change` | Another participant modified a shared event | "Sarah moved your 1:1 to 16:00" |

### Incident schema

```typescript
interface Incident {
    incident_id: string         // canonical hash (see 5.1)
    type: "overlap" | "prep_risk" | "commute_risk" | "overload" | "external_change"
    event_ids: string[]         // affected calendar event IDs
    time_window: {
        start: DateTime
        end: DateTime
    }
    priority_mix: ("HIGH" | "MEDIUM" | "LOW")[]  // priorities of involved events
    confidence: number          // 0.0-1.0, min confidence of involved events
    dependencies: string[]      // incident_ids this is linked to
}
```

### 5.1 Canonical incident_id

The incident_id must be stable across minor time shifts. Otherwise dedup/cooldown breaks.

```
incident_id = hash(
    type,
    sorted(event_ids),
    time_bucket(time_window)    // 30-min bucket
)
```

**time_bucket** rounds to 30-minute slots:
- 14:00-14:45 → bucket "14:00"
- 14:15-15:00 → bucket "14:00"
- Both produce same bucket → same incident_id → dedup works

If a meeting shifts by 1+ hour → new bucket → new incident_id. This is correct: a significant time shift may change the situation.

### 5.2 Detection filters

Before creating incidents, the detect stage checks the **resolve_log**:
- If `incident_id` was resolved with `kept_as_is` → skip (suppressed for the day)
- If `incident_id` was resolved with `dismissed` AND cooldown hasn't expired → skip
- If `incident_id` was resolved with `applied` → skip (already fixed)

---

## 6. Day Context Layer

Sits between detect and propose. Aggregates all incidents into a day-level view.

### Day summary schema

```typescript
interface DaySummary {
    total_meetings: number
    total_incidents: number
    incident_types: Record<IncidentType, number>  // { overlap: 2, prep_risk: 1, ... }
    estimated_decision_count: number               // rough count before propose
    time_pressure: number                          // minutes until first incident
    first_incident_time: DateTime
}
```

### Day context rules

| Condition | Hint to propose stage |
|---|---|
| `estimated_decision_count >= 3` | Bundle all incidents into one comprehensive plan (force Tier 1) |
| `total_incidents >= 4` AND any incident would be Tier 2+ | Bundle into plan (force Tier 1) — "death by a thousand Tier 2s" prevention |
| `time_pressure < 30 min` | Prioritize speed: shortest possible brief, most urgent action only |
| `total_incidents == 1` | Standard single-incident handling |

**Why this matters:** Without day context, a day with 4 independent Tier 2 issues would produce 4 separate briefs throughout the day. That's worse UX than one Tier 1 morning plan that handles everything at once.

---

## 7. Decision Packages

A decision package = **one user approval prompt**. It may bundle multiple calendar mutations.

**Fundamental rule: count packages, never raw mutations.**

"Move 2 low-priority meetings to free prep hour" = 1 package (1 approval).

### Package schema

```typescript
interface DecisionPackage {
    package_id: string
    action_class: "INFO" | "SOFT" | "HARD"
    incident_ids: string[]                          // which incidents this resolves
    mutations: Mutation[]                           // individual calendar changes
    affected_events_count: number                   // distinct events touched
    shifted_minutes_total: number                   // total schedule displacement
    requires_approval: boolean                      // set by authorize stage
    confidence: number                              // min(confidence) of related incidents
    plan_revision_id: string                        // for optimistic locking
    idempotency_key: string                         // prevents double-apply
}

interface Mutation {
    event_id: string
    action: "move" | "decline" | "cancel" | "shorten"
    target_slot?: { start: DateTime, end: DateTime }
    details: string                                 // human-readable: "Move to 16:00-17:00"
}
```

### Action classification

| Class | Examples | Decision required by default? |
|---|---|---|
| `INFO` | Notify, explain, surface external change | **Never** |
| `SOFT` | Set reminder, tentative hold, suggest focus block | **Only if `auto_soft_enabled = false`** |
| `HARD` | Reschedule, decline, cancel, shorten, create blocking prep | **Always** |

### Two blast radius fields

Two fields, not one. Evaluated independently for tier classification:

- `affected_events_count` — how many distinct events are touched
- `shifted_minutes_total` — how much total schedule displacement in minutes

**Why two fields:** Moving 3 events by 5 minutes each (shifted_minutes = 15) is very different from moving 1 event by 3 hours (shifted_minutes = 180). Both matter.

### Propose stage constraints

1. **NEVER generate mutations for hard_locked events.** Locked events are immovable walls.
2. **Bundle related mutations into one package** when they're logically connected (e.g., "move A to make room for B").
3. **Keep unrelated mutations as separate packages** so the user can approve/deny independently.
4. **Respect day_context hints** — if context says "bundle as plan," group all packages into one comprehensive plan.

---

## 8. Authorization

Per-package, not global. Each package is independently gated.

### Confidence gating (per-package)

| Package confidence | Allowed action class | Effect |
|---|---|---|
| < 0.6 | INFO only | Downgrade to informational. Ask/clarify, don't propose mutations. |
| 0.6 - 0.8 | max SOFT | Can suggest, can set reminders, but no calendar mutations. |
| >= 0.8 | Full capability | HARD mutations allowed. |

**Why per-package, not global:** If one incident has low confidence but another has high confidence, the low-confidence one gets downgraded while the high-confidence one operates normally. Global gating would suppress the entire day.

### Policy checks

```python
def authorize(package, policy):
    # Confidence gating
    if package.confidence < 0.6:
        package.action_class = "INFO"
        package.requires_approval = False
        return
    if package.confidence < 0.8:
        package.action_class = min(package.action_class, "SOFT")

    # Action class authorization
    if package.action_class == "INFO":
        package.requires_approval = False
    elif package.action_class == "SOFT":
        package.requires_approval = not policy.auto_soft_enabled
    elif package.action_class == "HARD":
        package.requires_approval = True
        # Exception: auto-move low-priority if policy allows
        if (policy.max_auto_changes_low_priority > 0
            and package.affects_only_low_priority
            and not package.declines_confirmed_meetings
            and package.affected_events_count <= policy.max_auto_changes_low_priority):
            package.requires_approval = False
```

---

## 9. Tier Classification

### 9.1 Control Variables

| Variable | Description | Source |
|---|---|---|
| `decision_count` | Number of packages where `requires_approval = true` | authorize stage output |
| `interdependent` | Any package's resolution changes options for another | dependency analysis |
| `affected_events_count_max` | Max `affected_events_count` across all packages | package data |
| `affected_events_count_total` | Sum of `affected_events_count` across all packages | package data |
| `shifted_minutes_total` | Sum of `shifted_minutes_total` across all packages | package data |

### 9.2 Deterministic Classification Algorithm

```python
def classify_tier(packages, incidents, day_context):
    decision_count = sum(1 for p in packages if p.requires_approval)
    interdependent = has_interdependent_packages(packages)
    affected_max = max(p.affected_events_count for p in packages) if packages else 0
    affected_total = sum(p.affected_events_count for p in packages)
    shifted_total = sum(p.shifted_minutes_total for p in packages)

    # Step 1: Check forced Tier 1 overrides
    force_tier1 = any([
        has_high_high_overlap(incidents),
        has_medium_medium_overlap(incidents),
        max_overlap_in_one_slot(incidents) >= 3,
        day_context.total_meetings >= 12,
        interdependent,
        affected_max >= 3,
        day_context.force_tier1,  # from day context layer
    ])

    # Step 2: Base classification
    if force_tier1:
        return TIER_1
    elif decision_count == 0:
        return TIER_3
    elif decision_count == 1:
        return TIER_2
    elif (decision_count == 2
          and not interdependent
          and affected_total <= 2
          and shifted_total <= 90):
        return TIER_2
    else:
        return TIER_1
```

**This is fully deterministic. Every calendar state maps to exactly one tier. No ambiguity.**

### 9.3 Priority Matrix (Forced Overrides)

For 2-meeting overlaps, the priority of the conflicting meetings determines behavior:

| Meeting A | Meeting B | Decision Packages | Tier |
|---|---|---|---|
| HIGH | HIGH | 2+ (neither auto-resolvable) | **Tier 1 (forced)** |
| HIGH | MEDIUM | 1 (AI recommends HIGH) | Tier 2 |
| HIGH | LOW | 1 (obvious, confirm) | Tier 2 |
| MEDIUM | MEDIUM | 2+ (neither disposable) | **Tier 1 (forced)** |
| MEDIUM | LOW | 1 (keep MEDIUM) | Tier 2 |
| LOW | LOW | 0 (FYI only) | Tier 3 |

**Special rule:** 3+ meetings in any single slot → always Tier 1, regardless of priorities.

### 9.4 Prep Time Integration

| Meeting needing prep | Prep slot state | Packages | Tier |
|---|---|---|---|
| HIGH meeting | Empty | 0 (SOFT: block it) | Tier 3 |
| HIGH meeting | LOW meetings only | 1 (HARD: move lows) | Tier 2 |
| HIGH meeting | MEDIUM or HIGH | 2+ (restructure) | Tier 1 |
| MEDIUM (strategic) | Empty | 0 (SOFT: suggest) | Tier 3 |
| MEDIUM (strategic) | LOW only | 1 (HARD: move lows) | Tier 2 |

### 9.5 Overload Thresholds

| Meetings/day | Conflicts? | Tier | Notes |
|---|---|---|---|
| 12+ | Any | Tier 1 | Overloaded, plan mode |
| 8-11 | No | Tier 2 | Heavy but manageable |
| 8-11 | Yes | Per conflict rules | Likely Tier 1 |
| <= 7 | No | Tier 3 | Normal day |
| <= 7 | Yes | Per conflict rules | — |

**V2 adaptive thresholds:**
After 2-3 weeks of data, thresholds personalize:

```python
user_baseline = rolling_average(meetings_per_day, last_14_days)
user_stddev = stddev(meetings_per_day, last_14_days)

overload_warning = max(6, user_baseline + 1.0 * user_stddev)   # Tier 2
overload_critical = max(8, user_baseline + 2.0 * user_stddev)  # Tier 1
```

Executive (baseline 14, stddev 3): warning=17, critical=20.
IC developer (baseline 4, stddev 2): warning=6, critical=8.

---

## 10. Message Generation (NabuBrief)

### 10.1 Component definition

```swift
enum NabuBriefSeverity {
    case info       // Tier 3 — blue tint
    case warning    // Tier 2 — amber tint
    case urgent     // Tier 1 — red tint
}

struct NabuBrief {
    let headline: String              // Natural-language AI message
    let severity: NabuBriefSeverity
    var actionLabel: String? = nil     // Primary CTA: "Set reminder", "Reschedule"
    var dismissLabel: String? = nil    // Dismissive: "Dismiss", "Keep as is"
}
```

### 10.2 Tier-to-UX mapping

| Tier | Severity | Brief actions | Screen below brief |
|---|---|---|---|
| **Tier 1** | `.urgent` (red) | No inline action | Scrollable plan → "Apply plan" button at bottom |
| **Tier 2** | `.warning` (amber) | Primary CTA + Dismiss | Normal calendar timeline |
| **Tier 3** | `.info` (blue) | Optional CTA + Dismiss | Normal calendar timeline |

### 10.3 Visual design

- **Background**: severity tint with low opacity (blue 22%, amber 10%, red 8%)
- **Border**: severity tint with medium opacity (none for info, 18% for warning, 15% for urgent)
- **Typography**: headline is 16pt semibold rounded, ink color at 85% opacity
- **Actions**: primary CTA is ink-colored capsule with bold white text; dismiss is semibold text at 45% opacity
- **Corner radius**: 18pt continuous
- **Padding**: 16pt all sides
- **No icons, no labels, no sparkle indicators.** The message IS the product.

### 10.4 Brief preemption

When a new brief has a higher tier than the currently displayed brief:

| New tier vs current | Behavior |
|---|---|
| New Tier 1 vs current Tier 2/3 | Immediately replace |
| New Tier 2 vs current Tier 3 | Immediately replace |
| New Tier 3 vs current Tier 1/2 | Queue for digest |
| Same tier, same incident | No change (dedup) |
| Same tier, different incident | No change (keep current) |

Preempted briefs go to digest, not lost. Transition is a fade animation.

---

## 11. Execution

### 11.1 Execution flow

```
User clicks action ("Apply plan" / "Reschedule" / "Set reminder")
    ↓
Check idempotency_key → if already executed, no-op
    ↓
Verify plan_revision_id → compare calendar etag/version
    ↓
If calendar changed since plan was generated:
    → Re-run pipeline (detect → ... → message)
    → Present new brief with updated plan
    → New plan_revision_id
    ↓
If calendar unchanged:
    → Execute mutations atomically per package
    → If any mutation fails: STOP
    → Report result to resolve stage
```

### 11.2 Atomicity rules

1. All mutations within one package succeed or all fail (atomic per package).
2. In a multi-package plan: if package N fails, stop. Do not silently continue with N+1, N+2, etc.
3. On partial failure:
   - Keep already-applied packages
   - Re-plan remaining packages with updated calendar state
   - Present new confirmation to user
   - Example message: "2 of 6 changes applied. Meeting X was already cancelled. Here's the updated plan for the remaining 4."
4. Never silently continue after a failure.

### 11.3 Idempotency

Every plan carries an `idempotency_key`. If the user clicks "Apply" twice (network lag, double-tap), the second execution is a no-op. The key is generated at propose stage and is unique per plan_revision.

---

## 12. Resolution

The final stage. Records what happened so the system doesn't repeat itself.

### Resolution schema

```typescript
interface Resolution {
    resolution_id: string
    incident_id: string
    user_action: "applied" | "dismissed" | "kept_as_is" | "expired"
    timestamp: DateTime
    suppress_until: DateTime | null    // cooldown expiry
    suppress_forever: boolean          // user chose to keep the conflict
}
```

### Resolution rules

| User action | System behavior |
|---|---|
| **applied** | Incident resolved. Remove from active list. Log success. |
| **dismissed** | Cooldown 90 minutes. After cooldown, can resurface IF situation changed (new events added, etc.). |
| **kept_as_is** | Suppress this specific incident for the rest of the day. User consciously decided. Don't nag. |
| **expired** | TTL reached (24h for Tier 3). Remove silently. |

### Feedback loop

Resolution data feeds back into:
1. **Detect stage** — filter out suppressed incidents
2. **Observability** — accept_rate, dismiss_rate, etc.
3. **Learning loop (V2)** — adjust priority weights based on patterns

---

## 13. Delivery Policy

| Rule | Detail | Implementation |
|---|---|---|
| **One active brief** | Highest tier only. One NabuBrief visible at a time. | Message stage checks current active brief |
| **Preemption** | Higher tier replaces lower. Lower queues for digest. | See section 10.4 |
| **Queue lower tiers** | Batch into digest. Tier 3 max 2-3x/day. | Digest shown in secondary UI area |
| **Deduplication** | By canonical `incident_id`. Same incident = no duplicate brief. | Detect stage filters |
| **Cooldown** | 90 min after dismissal. | Resolve stage sets `suppress_until` |
| **TTL for Tier 3** | 24 hours, then expires silently. | Resolve stage auto-expires |
| **Working hours** | No triggers outside `working_hours` policy. | Trigger layer filters |

---

## 14. Policy Layer

Minimal set of user-configurable policies:

| Policy | Type | Default | Description |
|---|---|---|---|
| `auto_soft_enabled` | boolean | `true` | Auto-approve SOFT actions (reminders, tentative holds) |
| `never_auto_decline_high_medium` | boolean | `true` | Never auto-decline/cancel HIGH or MEDIUM without explicit approval |
| `working_hours` | time range | `09:00 - 18:00` | When proactive briefs can surface |
| `max_auto_changes_low_priority` | integer | `0` | Max HARD mutations on LOW priority events without asking (0 = always ask) |

**Design principle:** Complexity lives in policy toggles, not in branching UI logic. The UI always shows the same NabuBrief component — only the data changes.

---

## 15. Observability

### 15.1 Core metrics

| Metric | What it measures | Target |
|---|---|---|
| `accept_rate` | % of proposals approved by user | > 70% for Tier 2, > 60% for Tier 1 |
| `undo_rate` | % of approved actions reversed within 1h | < 5% |
| `re_prompt_rate` | % of incidents resurfacing after dismissal | < 10% |
| `time_to_resolution` | Minutes from brief shown to user action | < 5 min for Tier 2/3, < 15 min for Tier 1 |
| `false_positive_rate` | % of incidents that didn't need attention | < 10% |
| `annoyance_rate` | % of briefs dismissed without any action | < 15% for Tier 3 |

### 15.2 What to tune from metrics

| If metric is bad | Tune |
|---|---|
| Low accept_rate | Priority weights may be wrong. Check if proposals match user expectations. |
| High undo_rate | Plans are wrong. Check propose logic. |
| High re_prompt_rate | Cooldown too short or incident_id not stable. |
| High false_positive_rate | Detection thresholds too aggressive. |
| High annoyance_rate | Too many Tier 3 briefs. Increase TTL or reduce digest frequency. |

### 15.3 Logging

Every pipeline run logs:

```typescript
interface PipelineLog {
    run_id: string
    trigger: TriggerType
    incidents: Incident[]
    day_context: DaySummary
    packages: DecisionPackage[]
    tier: 1 | 2 | 3
    brief: NabuBrief
    user_action: string | null
    execution_result: "success" | "partial_failure" | "stale_replan" | null
    timestamp: DateTime
}
```

---

## 16. Rollout Plan

| Phase | What's enabled | Duration | Gate to next phase |
|---|---|---|---|
| **A: Shadow** | Pipeline runs silently, logs tier classifications. No user-facing output. | 2-4 weeks | Tier accuracy > 85% vs human labels |
| **B: Tier 3 only** | Info/reminders surface to users | 2-4 weeks | annoyance_rate < 15% |
| **C: Tier 2** | Single-decision approval prompts | 2-4 weeks | accept_rate > 70%, undo_rate < 5% |
| **D: Tier 1** | Full plan mode with "Apply plan" | Ongoing | accept_rate > 60%, false_positive_rate < 10% |

Each phase gate is measured on real user data. Do not advance until metrics are met.

---

## 17. Mockup Mapping

The three tier-relevant mockup screens in `LabotaCalendarMockups.swift`:

| Screen | Index | Tier | Incident | Packages | NabuBrief |
|---|---|---|---|---|---|
| **Today** | 4 | Tier 3 | `commute_risk` | 0 (SOFT: reminder) | headline: "Lunch at 13:00 needs 40 min commute. Want me to set a departure reminder at 12:15?" severity: `.info`, action: "Set reminder", dismiss: "Dismiss" |
| **Smart Prep** | 5 | Tier 2 | `prep_risk` | 1 (HARD: move meetings) | headline: "CEO review at 15:00 — I'd clear the hour before for prep. Move 3 meetings to tomorrow?" severity: `.warning`, action: "Reschedule", dismiss: "Keep as is" |
| **Nabu Plan** | 6 | Tier 1 | `overlap` + `prep_risk` | 3+ (HARD: restructure) | headline: "5 conflicts and CEO review needs prep. I can fix both — reschedule 6 meetings, free 2 hours." severity: `.urgent`, no inline action. "Apply plan" button below the plan. |

### NabuBrief SwiftUI implementation (current)

```swift
private enum NabuBriefSeverity {
    case info, warning, urgent
    var tint: Color {
        switch self {
        case .info: LabotaMockPalette.cloudBlue
        case .warning: LabotaMockPalette.warning
        case .urgent: LabotaMockPalette.critical
        }
    }
    var bgOpacity: Double {
        switch self {
        case .info: 0.22
        case .warning: 0.10
        case .urgent: 0.08
        }
    }
    var borderOpacity: Double {
        switch self {
        case .info: 0.0
        case .warning: 0.18
        case .urgent: 0.15
        }
    }
}

private struct NabuBrief: View {
    let headline: String
    let severity: NabuBriefSeverity
    var actionLabel: String? = nil
    var dismissLabel: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(self.headline)
                .font(.system(size: 16, weight: .semibold, design: .rounded))
                .foregroundStyle(LabotaMockPalette.ink.opacity(0.85))
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
            if self.actionLabel != nil || self.dismissLabel != nil {
                HStack(spacing: 10) {
                    if let dismiss = self.dismissLabel {
                        Text(dismiss)
                            .font(.system(size: 13, weight: .semibold, design: .rounded))
                            .foregroundStyle(LabotaMockPalette.ink.opacity(0.45))
                    }
                    Spacer()
                    if let action = self.actionLabel {
                        Text(action)
                            .font(.system(size: 13, weight: .bold, design: .rounded))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 8)
                            .background(LabotaMockPalette.ink, in: Capsule())
                    }
                }
                .padding(.top, 12)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous)
            .fill(self.severity.tint.opacity(self.severity.bgOpacity)))
        .overlay {
            if self.severity.borderOpacity > 0 {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(self.severity.tint.opacity(self.severity.borderOpacity), lineWidth: 1)
            }
        }
    }
}
```

### EventPriority SwiftUI implementation (current)

```swift
private enum EventPriority {
    case high, medium, low
    var label: String {
        switch self {
        case .high: "High"
        case .medium: "Medium"
        case .low: "Low"
        }
    }
    var color: Color {
        switch self {
        case .high: LabotaMockPalette.priorityHigh    // red
        case .medium: LabotaMockPalette.priorityMedium // amber
        case .low: LabotaMockPalette.priorityLow       // gray
        }
    }
}
```

---

## 18. Design Decisions Log

Chronological record of key decisions and WHY they were made.

### Decision 1: NabuBrief simplification
- **What**: Removed generic `NabuBrief<ContextContent: View>` with ViewBuilder. Made it a simple struct with headline + severity + actions.
- **Why**: User said "the current minimalistic style is very, very good" and "the important part is the message." ViewBuilder caused visual inconsistency across screens.
- **Date**: Session 1

### Decision 2: Three-tier system
- **What**: Tier 1 (plan), Tier 2 (decision), Tier 3 (info).
- **Why**: User described three distinct situations: "day is fucked" (restructure), "one thing needs prep" (decide), "commute reminder" (info). These map naturally to three tiers.
- **Date**: Session 1

### Decision 3: Priority-aware tier classification
- **What**: Meeting priority determines tier, not just conflict count. HIGH+HIGH → Tier 1. HIGH+LOW → Tier 2.
- **Why**: User insight: "If several low-priority meetings are overlapping with high-priority, that should NOT be Tier 1." Priority makes tier classification more accurate.
- **Date**: Session 1

### Decision 4: Decision count as primary tier variable
- **What**: Tier is driven by how many user approvals are needed, not by calendar state directly.
- **Why**: Codex review. "Decision = do I need permission to mutate?" This is outcome-oriented, not input-oriented. More extensible.
- **Date**: Session 2 (Codex review 1)

### Decision 5: Pipeline invariant
- **What**: `detect → propose → authorize → tier → message → execute`
- **Why**: Codex review. Tiering happens AFTER proposal and authorization, not before. The tier is an output of analysis, not an input.
- **Date**: Session 2 (Codex review 1)

### Decision 6: Two-score priority (importance + movability)
- **What**: Replace single priority waterfall with two independent scores.
- **Why**: Codex review. Single "priority" conflates importance (value of meeting) with movability (cost of rescheduling). These are orthogonal. Example: vendor sync is external (hard to move) but not important. Old system made it HIGH. New system correctly makes it MEDIUM.
- **Date**: Session 3 (Codex review 2)

### Decision 7: VIP as dominant signal with LLM inference
- **What**: VIP attendee is the strongest signal (+0.40 importance, +0.35 movability). LLM infers VIP, user calibrates.
- **Why**: User insight: "This is the MOST important parameter. If a meeting is with CEO, your manager, C-level, board — you NEVER skip it. And it's not just user-tagged, LLM should think for the user."
- **Date**: Session 4

### Decision 8: Downweight attendee count and external
- **What**: attendee_count reduced to micro-signal (+0.02/person). External reduced to +0.05 importance.
- **Why**: User insight: "30-person meeting is probably not super useful" and "external is also a bad parameter, it's not guaranteed that external meetings are important."
- **Date**: Session 4

### Decision 9: Importance >> Movability (0.75 / 0.25)
- **What**: Importance weighted 3x more than movability.
- **Why**: User insight: "Importance is an order of magnitude more important than movability." If meeting is critical, protect it regardless of logistics.
- **Date**: Session 4

### Decision 10: hard_lock as propose-stage filter, not signal
- **What**: Locked events are filtered out before proposer generates mutations.
- **Why**: Codex review 3. If it's locked, proposer shouldn't even consider it. Indirect protection (high movability score) is fragile.
- **Date**: Session 5 (Codex review 3)

### Decision 11: Confidence gating per-package
- **What**: Confidence gating in authorize stage, per-package, not global.
- **Why**: Codex review 3. Global gating suppresses entire day if one incident has low confidence. Per-package lets high-confidence incidents operate normally.
- **Date**: Session 5 (Codex review 3)

### Decision 12: Canonical incident_id with time bucketing
- **What**: incident_id = hash(type, sorted(event_ids), time_bucket_30min).
- **Why**: Codex review 3. Without canonical IDs, minor time shifts break dedup/cooldown.
- **Date**: Session 5 (Codex review 3)

### Decision 13: Brief preemption
- **What**: Higher-tier brief immediately replaces lower-tier. Lower queues for digest.
- **Why**: Codex review 3. Without preemption, user sees Tier 3 while Tier 1 waits in queue.
- **Date**: Session 5 (Codex review 3)

### Decision 14: Resolve stage + trigger layer + day context
- **What**: Extended pipeline from 6 to 8 stages.
- **Why**: Internal review. System needed to remember user decisions (resolve), know when to run (triggers), and see the day holistically (day context) to prevent "death by a thousand Tier 2s."
- **Date**: Session 6 (self-review)

### Decision 15: Partial failure policy
- **What**: On partial execution failure, stop + re-plan + new confirmation.
- **Why**: Codex review 3. Silent continuation after failure can break interdependent mutations.
- **Date**: Session 5 (Codex review 3)

---

## 19. Edge Cases & Test Scenarios

### Scenario 1: Two HIGH-HIGH overlaps in different time slots
- **Incidents**: 2x `overlap`, each HIGH+HIGH
- **Packages**: 2+ (can't auto-resolve either)
- **Forced Tier 1**: Yes (HIGH+HIGH overlap)
- **Brief**: "2 critical conflicts today. Here's a plan to resolve both."

### Scenario 2: One HIGH vs LOW conflict + one commute reminder
- **Incidents**: 1x `overlap` (HIGH+LOW), 1x `commute_risk`
- **Packages**: 1 HARD (move LOW), 0 SOFT (reminder)
- **Tier**: 2 (1 decision, highest tier wins over Tier 3)
- **Brief**: Shows Tier 2 conflict. Commute goes to digest.

### Scenario 3: Day with 4 independent MEDIUM-LOW conflicts
- **Incidents**: 4x `overlap`, each MEDIUM+LOW
- **Day context**: total_decision_count = 4 → force_tier1 = true
- **Tier**: 1 (bundled into morning plan)
- **Brief**: "4 scheduling conflicts today. Here's a plan to fix all of them."

### Scenario 4: CEO 1:1 needs prep, prep slot has 2 HIGH meetings
- **Incidents**: 1x `prep_risk` (CEO 1:1 = HIGH, prep slot has HIGH+HIGH)
- **Packages**: 2+ (need to restructure around CEO prep AND resolve HIGH+HIGH)
- **Forced Tier 1**: Yes (interdependent + HIGH+HIGH)
- **Brief**: "CEO review needs prep time, but your schedule is packed. Plan: ..."

### Scenario 5: External vendor sync overlaps with team standup
- **Vendor sync**: importance 0.24, movability 0.28, composite 0.25 → MEDIUM
- **Team standup**: importance 0.25, movability 0.30, composite 0.26 → MEDIUM
- **Incidents**: 1x `overlap` (MEDIUM+MEDIUM)
- **Forced Tier 1**: Yes (MEDIUM+MEDIUM overlap)
- **Brief**: "2 important meetings at 14:00. Neither is easy to skip. Plan: ..."

### Scenario 6: Doctor appointment (locked) at same time as team meeting
- **Doctor**: hard_locked, not movable
- **Team meeting**: MEDIUM
- **Proposer**: CANNOT generate mutation for doctor. Can only propose moving team meeting.
- **Packages**: 1 HARD (move team meeting)
- **Tier**: 2
- **Brief**: "Your team meeting at 14:00 conflicts with a locked event. Move to 15:00?"

### Scenario 7: User dismissed a conflict, then new meeting added to same slot
- **Step 1**: overlap incident at 14:00, user clicks "Keep as is" → resolve with `kept_as_is`
- **Step 2**: New meeting added to 14:00 slot
- **Detect**: Original incident_id is suppressed. But new meeting changes event_ids → new canonical incident_id → new incident detected
- **Result**: New brief surfaces. This is correct — the situation changed.

### Scenario 8: Calendar changes while user is reviewing Tier 1 plan
- **Step 1**: User sees Tier 1 plan (plan_revision_id = "abc123")
- **Step 2**: Someone cancels a meeting that's part of the plan
- **Step 3**: User clicks "Apply plan"
- **Execute**: Checks plan_revision_id against current calendar etag → MISMATCH
- **Result**: Re-run pipeline, generate new plan, present to user with new plan_revision_id

### Scenario 9: LLM infers VIP incorrectly
- **LLM thinks**: attendee "John" is VIP (confidence 0.65)
- **Effect**: John's meetings get importance += 0.26 (0.40 * 0.65) instead of +0.40
- **After 3 meetings with John**: Nabu asks "Mark John as VIP?"
- **User says no**: vip_flag = false for John. Future meetings score normally.

### Scenario 10: Power user with 18 meetings/day (executive)
- **V1**: 12+ = Tier 1 overload every day. Too aggressive.
- **V2 adaptive**: baseline = 16, stddev = 3. overload_critical = max(8, 22) = 22.
- **Result**: 18 meetings is normal for this user. No overload alert.

---

## 20. Glossary

| Term | Definition |
|---|---|
| **NabuBrief** | The UI component that displays the AI's proactive message. One per day maximum. |
| **Tier** | Urgency level (1=plan, 2=decision, 3=info) determined by decision count. |
| **Incident** | A detected calendar issue (overlap, prep_risk, etc.). |
| **Decision Package** | One user approval prompt, possibly bundling multiple mutations. |
| **Mutation** | A single calendar change (move, decline, cancel, shorten). |
| **VIP** | A contact whose meetings are high-priority. LLM-inferred + user-confirmed. |
| **hard_lock** | User flag that makes an event completely immovable. |
| **Blast radius** | Number of events affected + minutes shifted by a decision package. |
| **Composite score** | `importance * 0.75 + movability * 0.25` — determines priority class. |
| **Preemption** | Higher-tier brief replacing a lower-tier brief in real time. |
| **Resolve** | Recording what the user did (applied/dismissed/kept_as_is) so the system remembers. |
| **Cooldown** | 90-minute suppression period after user dismisses an incident. |
| **Digest** | Batched lower-tier briefs shown after active brief is resolved. |
| **Optimistic lock** | Verifying calendar hasn't changed before applying mutations. |
| **Idempotency key** | Prevents double-execution if user clicks "Apply" twice. |
| **Day context** | Aggregated view of all incidents for bundle/tier decisions. |
| **Trigger** | Event that causes the pipeline to run (app open, calendar change, etc.). |
| **Pipeline** | The 8-stage invariant: trigger → detect → day_context → propose → authorize → tier → message → execute → resolve |
