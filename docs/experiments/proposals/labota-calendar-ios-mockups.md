# Labota Calendar iOS Mockups (Wispr Flow Style)

This document defines the first visual direction for a dedicated Labota Calendar app.

## Style DNA

- Visual mood: quiet, premium, light, human.
- Background: soft gray (`#F2F2F5` range), not pure white.
- Typography:
  - hero headlines in serif (high contrast, elegant);
  - controls/body in rounded sans-serif.
- Accent language:
  - warm orange for semantic emphasis in headings;
  - lavender for primary setup/consent CTAs;
  - deep ink for strong actions.
- Shapes:
  - large rounded cards (16-28 radius);
  - subtle 1px ink borders;
  - generous vertical spacing.
- AI presence:
  - "cloud brief" card on the daily screen;
  - every event has an explicit AI importance label.

## Mockup Set

SwiftUI mockup gallery:

- [LabotaCalendarMockups.swift](/Users/tkanduev/Documents/New project/labota/apps/ios/Sources/Calendar/LabotaCalendarMockups.swift)

Screens included:

1. Onboarding Welcome
2. Connect Calendars (Google + Apple local)
3. Permission / Consent
4. Today Timeline (AI-prioritized)
5. Event Detail + AI Actions
6. Telegram Control Mode

## Product Notes Behind The Screens

- Google Calendar starts as the first external integration.
- Apple Calendar relies on local EventKit access on iOS.
- Consent model is explicit and mode-based:
  - Read-only
  - Suggest-only
  - Act with confirmation (default)
- Telegram remains the "assistant command center", while iOS app is the visual home.

## Usage

1. Open iOS project via `pnpm ios:open`.
2. Open the Swift file above.
3. Run SwiftUI preview for `LabotaCalendarMockupsView`.
4. Iterate copy/colors first, then wire selected screens to real flows.
