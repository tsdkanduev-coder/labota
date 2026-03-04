import SwiftUI

struct LabotaCalendarMockupsView: View {
    @State private var currentPage = 0

    private let screens: [(String, AnyView)] = [
        ("Onboarding", AnyView(WelcomeMockupScreen())),
        ("Calendars", AnyView(ConnectCalendarsMockupScreen())),
        ("Permissions", AnyView(PermissionMockupScreen())),
        ("Today", AnyView(TodayMockupScreen())),                       // Tier 3: info
        ("Smart Prep", AnyView(SmartPrepMockupScreen())),               // Tier 2: one decision
        ("Nabu Plan", AnyView(NabuPlanMockupScreen())),                 // Tier 1: conflicts + prep
        ("Event Detail", AnyView(EventDetailsMockupScreen())),
        ("Telegram", AnyView(TelegramControlMockupScreen())),
        ("Empty Day", AnyView(EmptyDayMockupScreen())),
        ("Bot Activity", AnyView(BotActivityMockupScreen())),
        ("In-App Chat", AnyView(InAppChatMockupScreen())),
    ]

    var body: some View {
        VStack(spacing: 0) {
            // Screen title
            Text(screens[currentPage].0)
                .font(.system(size: 13, weight: .bold, design: .rounded))
                .foregroundStyle(LabotaMockPalette.ink.opacity(0.5))
                .textCase(.uppercase)
                .tracking(0.8)
                .padding(.top, 8)
                .padding(.bottom, 4)

            // Page indicator
            Text("\(currentPage + 1) / \(screens.count)")
                .font(.system(size: 11, weight: .semibold, design: .rounded))
                .foregroundStyle(LabotaMockPalette.ink.opacity(0.3))
                .padding(.bottom, 8)

            // Fullscreen pager
            TabView(selection: $currentPage) {
                ForEach(Array(screens.enumerated()), id: \.offset) { index, screen in
                    screen.1
                        .tag(index)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
        }
        .background(LabotaMockPalette.canvas.ignoresSafeArea())
    }
}

private struct MockPhoneFrame<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        content
            .aspectRatio(390 / 844, contentMode: .fit)
            .frame(maxWidth: .infinity)
            .clipShape(RoundedRectangle(cornerRadius: 44, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 44, style: .continuous)
                    .stroke(LabotaMockPalette.ink.opacity(0.25), lineWidth: 1)
            }
            .shadow(color: .black.opacity(0.12), radius: 20, y: 12)
    }
}

private struct MockScreenContainer<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        ZStack {
            LabotaMockPalette.screen
            content
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct WelcomeMockupScreen: View {
    var body: some View {
        MockScreenContainer {
            VStack(spacing: 0) {
                Spacer(minLength: 60)

                VStack(spacing: 6) {
                    Text("Your day,")
                        .font(.system(size: 52, weight: .medium, design: .serif))
                        .foregroundStyle(LabotaMockPalette.ink)

                    Text("organized")
                        .font(.system(size: 56, weight: .medium, design: .serif))
                        .foregroundStyle(LabotaMockPalette.accent)
                }
                .multilineTextAlignment(.center)
                .padding(.horizontal, 26)

                Text("AI handles the boring stuff.\nYou just show up.")
                    .font(.system(size: 19, weight: .medium, design: .rounded))
                    .foregroundStyle(LabotaMockPalette.ink.opacity(0.62))
                    .multilineTextAlignment(.center)
                    .lineSpacing(4)
                    .padding(.top, 20)
                    .padding(.horizontal, 36)

                Spacer()

                // Subtle social proof
                HStack(spacing: 6) {
                    Image(systemName: "lock.shield.fill")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(LabotaMockPalette.success)
                    Text("Your data stays on your device")
                        .font(.system(size: 13, weight: .medium, design: .rounded))
                        .foregroundStyle(LabotaMockPalette.ink.opacity(0.5))
                }
                .padding(.bottom, 16)

                MockPrimaryButton(
                    title: "Get started",
                    style: .lavender)
                    .padding(.horizontal, 28)
                    .padding(.bottom, 28)
            }
        }
    }
}

private struct ConnectCalendarsMockupScreen: View {
    var body: some View {
        MockScreenContainer {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 14) {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(LabotaMockPalette.ink)

                    RoundedRectangle(cornerRadius: 3)
                        .fill(LabotaMockPalette.ink)
                        .frame(height: 7)

                    RoundedRectangle(cornerRadius: 3)
                        .fill(LabotaMockPalette.ink.opacity(0.25))
                        .frame(height: 7)
                }
                .padding(.horizontal, 22)
                .padding(.top, 22)

                Text("Connect your\ncalendars")
                    .font(.system(size: 44, weight: .medium, design: .serif))
                    .foregroundStyle(LabotaMockPalette.ink)
                    .multilineTextAlignment(.leading)
                    .padding(.horizontal, 22)
                    .padding(.top, 22)

                VStack(spacing: 14) {
                    CalendarConnectorCard(
                        icon: "g.circle.fill",
                        title: "Google Calendar",
                        subtitle: "2 calendars · work + personal",
                        statusLabel: "Connected",
                        tint: LabotaMockPalette.google)

                    CalendarConnectorCard(
                        icon: "apple.logo",
                        title: "Apple Calendar (device)",
                        subtitle: "Grant local EventKit access",
                        statusLabel: "Not connected",
                        tint: LabotaMockPalette.ink)
                }
                .padding(.horizontal, 22)
                .padding(.top, 28)

                Spacer(minLength: 16)

                Text("Your calendar data stays private.\nYou can disable access anytime in Settings.")
                    .font(.system(size: 14, weight: .medium, design: .rounded))
                    .foregroundStyle(LabotaMockPalette.ink.opacity(0.5))
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 22)

                MockPrimaryButton(
                    title: "Continue",
                    style: .dark)
                    .padding(.horizontal, 22)
                    .padding(.top, 16)
                    .padding(.bottom, 22)
            }
        }
    }
}

private struct PermissionMockupScreen: View {
    var body: some View {
        MockScreenContainer {
            VStack(alignment: .leading, spacing: 0) {
                // Progress bar — consistent with screen 2
                HStack(spacing: 14) {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(LabotaMockPalette.ink)

                    RoundedRectangle(cornerRadius: 3)
                        .fill(LabotaMockPalette.ink)
                        .frame(height: 7)

                    RoundedRectangle(cornerRadius: 3)
                        .fill(LabotaMockPalette.ink)
                        .frame(height: 7)
                }
                .padding(.horizontal, 22)
                .padding(.top, 22)

                Text("Allow access")
                    .font(.system(size: 50, weight: .medium, design: .serif))
                    .foregroundStyle(LabotaMockPalette.ink)
                    .padding(.horizontal, 22)
                    .padding(.top, 22)

                Text("Nabu uses this to sync your schedule,\nfind conflicts, and suggest the best slots.")
                    .font(.system(size: 17, weight: .medium, design: .rounded))
                    .foregroundStyle(LabotaMockPalette.ink.opacity(0.74))
                    .padding(.horizontal, 22)
                    .padding(.top, 10)

                RoundedRectangle(cornerRadius: 26, style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [
                                LabotaMockPalette.lavender.opacity(0.9),
                                LabotaMockPalette.cloudBlue.opacity(0.9),
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing))
                    .overlay {
                        VStack(spacing: 10) {
                            Image(systemName: "calendar.badge.clock")
                                .font(.system(size: 42, weight: .semibold))
                                .foregroundStyle(LabotaMockPalette.ink.opacity(0.92))

                            Text("Read + Write access")
                                .font(.system(size: 20, weight: .semibold, design: .rounded))
                                .foregroundStyle(LabotaMockPalette.ink)

                            Text("Recommended for assistant mode")
                                .font(.system(size: 14, weight: .medium, design: .rounded))
                                .foregroundStyle(LabotaMockPalette.ink.opacity(0.67))
                        }
                    }
                    .frame(height: 232)
                    .padding(.horizontal, 22)
                    .padding(.top, 30)

                VStack(spacing: 12) {
                    ConsentLine(text: "Never shares raw events with third parties")
                    ConsentLine(text: "Every action appears in your audit history")
                    ConsentLine(text: "Control mode can be changed anytime")
                }
                .padding(.horizontal, 22)
                .padding(.top, 22)

                Spacer(minLength: 18)

                MockPrimaryButton(
                    title: "Allow access",
                    style: .lavender)
                    .padding(.horizontal, 22)

                MockPrimaryButton(
                    title: "Keep read-only",
                    style: .outline)
                    .padding(.horizontal, 22)
                    .padding(.top, 10)
                    .padding(.bottom, 20)
            }
        }
    }
}

private struct TodayMockupScreen: View {
    // Simulating "now" = 11:45 — between 1:1 and lunch
    private let events: [TodayEvent] = [
        TodayEvent(
            start: "09:30",
            end: "10:15",
            title: "Board sync with investors",
            place: "Zoom · Financial review",
            priority: .high,
            type: .strategic,
            isPast: true),
        TodayEvent(
            start: "11:00",
            end: "11:30",
            title: "1:1 with Product Lead",
            place: "Google Meet",
            priority: .medium,
            type: .oneOnOne,
            isPast: true),
        TodayEvent(
            start: "13:00",
            end: "14:30",
            title: "Client lunch reservation",
            place: "SHE Belorusskaya · 4 guests",
            priority: .high,
            type: .strategic,
            isPast: false),
        TodayEvent(
            start: "15:00",
            end: "17:00",
            title: "Presentation prep",
            place: "No distractions",
            priority: .medium,
            type: .focus,
            isPast: false),
        TodayEvent(
            start: "18:30",
            end: "19:00",
            title: "Gym",
            place: "World Class",
            priority: .low,
            type: .personal,
            isPast: false),
    ]

    var body: some View {
        MockScreenContainer {
            VStack(alignment: .leading, spacing: 0) {
                // Header — date is the hero
                DayHeader(date: "Thursday, Feb 26")

                NabuBrief(
                    headline: "Lunch at 13:00 needs 40 min commute. Want me to set a departure reminder at 12:15?",
                    severity: .info,
                    actionLabel: "Yes")
                    .padding(.horizontal, 22)
                    .padding(.top, 12)

                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(self.events.filter(\.isPast)) { event in
                            TodayEventCard(event: event)
                                .padding(.bottom, 8)
                        }

                        NowIndicator()
                            .padding(.vertical, 6)

                        ForEach(self.events.filter { !$0.isPast }) { event in
                            TodayEventCard(event: event)
                                .padding(.bottom, 8)
                        }
                    }
                    .padding(.horizontal, 22)
                    .padding(.top, 10)
                    .padding(.bottom, 30)
                }
                .mask(
                    VStack(spacing: 0) {
                        Color.black
                        LinearGradient(
                            colors: [.black, .clear],
                            startPoint: .top,
                            endPoint: .bottom)
                            .frame(height: 40)
                    }
                )
            }
        }
    }
}

// MARK: - Screen: Smart Prep (simple case — prep time, no conflicts)

private struct SmartPrepMockupScreen: View {
    private let events: [TodayEvent] = [
        TodayEvent(start: "10:00", end: "10:30", title: "Team standup",
                   place: "Google Meet", priority: .low, type: .meeting, isPast: true),
        TodayEvent(start: "13:00", end: "13:30", title: "1:1 with Alex",
                   place: "Google Meet", priority: .medium, type: .oneOnOne, isPast: false),
        TodayEvent(start: "13:30", end: "14:00", title: "1:1 with Maria",
                   place: "Zoom", priority: .medium, type: .oneOnOne, isPast: false),
        TodayEvent(start: "14:00", end: "14:30", title: "Design review",
                   place: "Figma + Meet", priority: .low, type: .meeting, isPast: false),
        TodayEvent(start: "15:00", end: "16:30", title: "Product review with CEO",
                   place: "HQ · Board room", priority: .high, type: .strategic, isPast: false),
    ]

    var body: some View {
        MockScreenContainer {
            VStack(alignment: .leading, spacing: 0) {
                DayHeader(date: "Thursday, Feb 26")

                // AI brief — prep needed, clear action
                NabuBrief(
                    headline: "CEO review at 15:00 — I'd clear the hour before for prep. Move 3 meetings to tomorrow?",
                    severity: .warning,
                    actionLabel: "Yes")
                    .padding(.horizontal, 22)
                    .padding(.top, 12)

                // Timeline
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(self.events.filter(\.isPast)) { event in
                            TodayEventCard(event: event)
                                .padding(.bottom, 8)
                        }
                        NowIndicator(time: "13:00")
                            .padding(.vertical, 6)
                        ForEach(self.events.filter { !$0.isPast }) { event in
                            TodayEventCard(event: event)
                                .padding(.bottom, 8)
                        }
                    }
                    .padding(.horizontal, 22)
                    .padding(.top, 10)
                    .padding(.bottom, 30)
                }
                .mask(
                    VStack(spacing: 0) {
                        Color.black
                        LinearGradient(
                            colors: [.black, .clear],
                            startPoint: .top,
                            endPoint: .bottom)
                            .frame(height: 40)
                    }
                )
            }
        }
    }
}

// MARK: - Screen: Nabu Plan (unified: conflicts + prep + overload)

private struct NabuPlanMockupScreen: View {
    var body: some View {
        MockScreenContainer {
            VStack(alignment: .leading, spacing: 0) {
                DayHeader(date: "Thursday, Feb 26")

                NabuBrief(
                    headline: "5 conflicts and CEO review needs prep. I can fix both — reschedule 6 meetings, free 2 hours.",
                    severity: .urgent)
                    .padding(.horizontal, 22)
                    .padding(.top, 12)

                // Action plan — what Nabu will actually do
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 6) {
                        // CONFLICTS
                        ConflictSlotHeader(
                            time: "10:00–12:00",
                            count: 4,
                            isNearest: true)

                        ConflictCard(
                            title: "Leaders meeting",
                            time: "10:00–12:00",
                            place: "HQ · Main hall",
                            action: .keep,
                            reason: "Highest priority")

                        ConflictCard(
                            title: "B2C Assistant standup",
                            time: "10:00–10:30",
                            place: "Google Meet",
                            action: .decline,
                            reason: "Recurring, can async")

                        ConflictCard(
                            title: "Reports refactoring",
                            time: "10:30–11:00",
                            place: "Google Meet",
                            action: .move,
                            reason: "→ Fri 10:30")

                        ConflictCard(
                            title: "SBOL feature review",
                            time: "11:00–12:00",
                            place: "Zoom",
                            action: .decline,
                            reason: "Low priority")

                        ConflictSlotHeader(
                            time: "14:00–15:00",
                            count: 2,
                            isNearest: false)

                        ConflictCard(
                            title: "Agents Digest B2C",
                            time: "14:00–15:00",
                            place: "Zoom",
                            action: .move,
                            reason: "→ Thu 16:00")

                        ConflictCard(
                            title: "Smart Search contract",
                            time: "14:00–15:00",
                            place: "Zoom",
                            action: .decline,
                            reason: "Can delegate")

                        // CEO PREP — same visual language, different reason
                        HStack(spacing: 8) {
                            Text("PREP")
                                .font(.system(size: 10, weight: .heavy, design: .rounded))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(LabotaMockPalette.strategic, in: Capsule())
                            Text("14:00–15:00 · clear for CEO review")
                                .font(.system(size: 13, weight: .bold, design: .rounded))
                                .foregroundStyle(LabotaMockPalette.strategic)
                            VStack { Divider() }
                        }
                        .padding(.top, 10)

                        ConflictCard(
                            title: "1:1 with Alex",
                            time: "13:30–14:00",
                            place: "Google Meet",
                            action: .move,
                            reason: "→ Tomorrow 13:30")

                        ConflictCard(
                            title: "Design review",
                            time: "14:00–14:30",
                            place: "Figma + Meet",
                            action: .move,
                            reason: "→ Fri 14:00")

                        // Result
                        Text("Result: 8 meetings · 0 conflicts · 1 h prep")
                            .font(.system(size: 13, weight: .semibold, design: .rounded))
                            .foregroundStyle(LabotaMockPalette.ink.opacity(0.55))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                    }
                    .padding(.horizontal, 22)
                    .padding(.top, 4)
                    .padding(.bottom, 24)
                }
                .mask(
                    VStack(spacing: 0) {
                        Color.black
                        LinearGradient(
                            colors: [.black, .clear],
                            startPoint: .top,
                            endPoint: .bottom)
                            .frame(height: 30)
                    }
                )

                // One CTA for everything
                MockPrimaryButton(title: "Apply plan", style: .dark)
                    .padding(.horizontal, 22)
                    .padding(.bottom, 20)
            }
        }
    }
}


private struct EventDetailsMockupScreen: View {
    var body: some View {
        MockScreenContainer {
            VStack(alignment: .leading, spacing: 0) {
                // Nav
                HStack(spacing: 12) {
                    RoundedRectangle(cornerRadius: 999)
                        .fill(LabotaMockPalette.ink.opacity(0.08))
                        .frame(width: 38, height: 38)
                        .overlay {
                            Image(systemName: "chevron.left")
                                .font(.system(size: 17, weight: .semibold))
                                .foregroundStyle(LabotaMockPalette.ink)
                        }

                    Spacer()

                    // Override priority button
                    HStack(spacing: 4) {
                        Image(systemName: "slider.horizontal.3")
                            .font(.system(size: 13, weight: .semibold))
                        Text("Priority")
                            .font(.system(size: 13, weight: .semibold, design: .rounded))
                    }
                    .foregroundStyle(LabotaMockPalette.ink.opacity(0.5))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(LabotaMockPalette.ink.opacity(0.06), in: Capsule())
                }
                .padding(.horizontal, 22)
                .padding(.top, 18)

                // Hero card — dark
                RoundedRectangle(cornerRadius: 26, style: .continuous)
                    .fill(LabotaMockPalette.ink.opacity(0.97))
                    .overlay {
                        VStack(alignment: .leading, spacing: 12) {
                            HStack(spacing: 14) {
                                Label("13:00–14:30", systemImage: "clock")
                                    .font(.system(size: 14, weight: .semibold, design: .rounded))
                                    .foregroundStyle(.white.opacity(0.75))

                                Label("1 h 30 min", systemImage: "hourglass")
                                    .font(.system(size: 14, weight: .semibold, design: .rounded))
                                    .foregroundStyle(.white.opacity(0.55))
                            }

                            Text("Client lunch\nreservation")
                                .font(.system(size: 30, weight: .medium, design: .serif))
                                .foregroundStyle(.white)
                                .lineSpacing(2)

                            HStack(spacing: 6) {
                                Image(systemName: "mappin.circle.fill")
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(LabotaMockPalette.accent)
                                Text("SHE Belorusskaya · 4 guests")
                                    .font(.system(size: 15, weight: .medium, design: .rounded))
                                    .foregroundStyle(.white.opacity(0.8))
                            }

                            HStack(spacing: 8) {
                                PriorityPill(text: "High priority", color: LabotaMockPalette.priorityHigh)
                                PriorityPill(text: "Strategic", color: LabotaMockPalette.strategic)
                                PriorityPill(text: "40 min", color: LabotaMockPalette.warning)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(22)
                    }
                    .frame(height: 230)
                    .padding(.horizontal, 22)
                    .padding(.top, 14)

                // Contextual AI actions — specific to THIS event
                HStack(spacing: 6) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(LabotaMockPalette.accent)
                    Text("Nabu suggests")
                        .font(.system(size: 13, weight: .bold, design: .rounded))
                        .foregroundStyle(LabotaMockPalette.ink.opacity(0.6))
                        .textCase(.uppercase)
                        .tracking(0.6)
                }
                .padding(.horizontal, 22)
                .padding(.top, 18)

                VStack(spacing: 8) {
                    // Context-aware actions for a restaurant lunch
                    ContextualActionRow(
                        icon: "location.fill",
                        title: "Set departure reminder",
                        subtitle: "Leave at 12:15 to arrive on time",
                        accentColor: LabotaMockPalette.warning)

                    ContextualActionRow(
                        icon: "paperplane.fill",
                        title: "Send address to guests",
                        subtitle: "Share location via Telegram",
                        accentColor: LabotaMockPalette.strategic)

                    ContextualActionRow(
                        icon: "fork.knife",
                        title: "Pre-order food & drinks",
                        subtitle: "Browse SHE menu, order ahead for 4",
                        accentColor: LabotaMockPalette.success)

                    ContextualActionRow(
                        icon: "arrow.triangle.2.circlepath",
                        title: "Cancel or reschedule",
                        subtitle: "Nabu apologizes and reschedules for you",
                        accentColor: LabotaMockPalette.critical)
                }
                .padding(.horizontal, 22)
                .padding(.top, 10)

                Spacer(minLength: 14)
            }
        }
    }
}

private struct ContextualActionRow: View {
    let icon: String
    let title: String
    let subtitle: String
    let accentColor: Color

    var body: some View {
        HStack(spacing: 0) {
            // Left accent bar
            Rectangle()
                .fill(self.accentColor.opacity(0.35))
                .frame(width: 3)

            HStack(spacing: 12) {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(self.accentColor.opacity(0.12))
                    .frame(width: 36, height: 36)
                    .overlay {
                        Image(systemName: self.icon)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(self.accentColor)
                    }

                VStack(alignment: .leading, spacing: 2) {
                    Text(self.title)
                        .font(.system(size: 15, weight: .semibold, design: .rounded))
                        .foregroundStyle(LabotaMockPalette.ink)
                    Text(self.subtitle)
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundStyle(LabotaMockPalette.ink.opacity(0.5))
                }

                Spacer(minLength: 0)

                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(LabotaMockPalette.ink.opacity(0.2))
            }
            .padding(.leading, 12)
            .padding(.trailing, 14)
        }
        .frame(height: 64)
        .background(.white.opacity(0.7))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(LabotaMockPalette.ink.opacity(0.08), lineWidth: 1)
        }
    }
}

private struct TelegramControlMockupScreen: View {
    var body: some View {
        MockScreenContainer {
            VStack(alignment: .leading, spacing: 0) {
                Text("Nabu in\nTelegram")
                    .font(.system(size: 44, weight: .medium, design: .serif))
                    .foregroundStyle(LabotaMockPalette.ink)
                    .lineSpacing(2)
                    .padding(.horizontal, 22)
                    .padding(.top, 22)

                Text("Manage your calendar\nwithout leaving the chat.")
                    .font(.system(size: 17, weight: .medium, design: .rounded))
                    .foregroundStyle(LabotaMockPalette.ink.opacity(0.62))
                    .lineSpacing(3)
                    .padding(.horizontal, 22)
                    .padding(.top, 10)

                // Chat example
                VStack(spacing: 8) {
                    ChatBubble(
                        text: "Book HITE for Friday 20:00",
                        style: .user)

                    ChatBubble(
                        text: "Done. Added to calendar + reminder set.",
                        style: .assistant)
                }
                .padding(.horizontal, 22)
                .padding(.top, 20)

                // Permission level — clear human question
                Text("What can Nabu do?")
                    .font(.system(size: 20, weight: .semibold, design: .rounded))
                    .foregroundStyle(LabotaMockPalette.ink)
                    .padding(.horizontal, 22)
                    .padding(.top, 26)

                Text("You decide how much freedom Nabu gets.")
                    .font(.system(size: 14, weight: .medium, design: .rounded))
                    .foregroundStyle(LabotaMockPalette.ink.opacity(0.5))
                    .padding(.horizontal, 22)
                    .padding(.top, 4)

                VStack(spacing: 8) {
                    ModeRow(
                        icon: "eye",
                        title: "Look, don't touch",
                        subtitle: "Reads your schedule, gives tips — changes nothing",
                        selected: false)
                    ModeRow(
                        icon: "hand.raised",
                        title: "Ask me first",
                        subtitle: "Books & reschedules only after you say OK",
                        selected: true)
                }
                .padding(.horizontal, 22)
                .padding(.top, 12)

                Spacer(minLength: 16)

                MockPrimaryButton(
                    title: "Connect Telegram",
                    style: .dark)
                    .padding(.horizontal, 22)
                    .padding(.bottom, 22)
            }
        }
    }
}

private struct CalendarConnectorCard: View {
    let icon: String
    let title: String
    let subtitle: String
    let statusLabel: String
    let tint: Color

    var body: some View {
        RoundedRectangle(cornerRadius: 22, style: .continuous)
            .fill(.white.opacity(0.66))
            .overlay {
                HStack(spacing: 12) {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(self.tint.opacity(0.18))
                        .frame(width: 44, height: 44)
                        .overlay {
                            Image(systemName: self.icon)
                                .font(.system(size: 20, weight: .semibold))
                                .foregroundStyle(self.tint)
                        }

                    VStack(alignment: .leading, spacing: 3) {
                        Text(self.title)
                            .font(.system(size: 19, weight: .semibold, design: .rounded))
                            .foregroundStyle(LabotaMockPalette.ink)
                        Text(self.subtitle)
                            .font(.system(size: 14, weight: .medium, design: .rounded))
                            .foregroundStyle(LabotaMockPalette.ink.opacity(0.6))
                    }

                    Spacer()

                    Text(self.statusLabel)
                        .font(.system(size: 12, weight: .bold, design: .rounded))
                        .foregroundStyle(LabotaMockPalette.ink)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 7)
                        .background(LabotaMockPalette.lavender.opacity(0.95), in: Capsule())
                }
                .padding(14)
            }
            .overlay {
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .stroke(LabotaMockPalette.ink.opacity(0.14), lineWidth: 1)
            }
            .frame(height: 84)
    }
}

private struct ConsentLine: View {
    let text: String

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(LabotaMockPalette.success)
            Text(self.text)
                .font(.system(size: 15, weight: .medium, design: .rounded))
                .foregroundStyle(LabotaMockPalette.ink.opacity(0.78))
            Spacer(minLength: 0)
        }
    }
}

// MARK: - Day Header (date-first, functional)

private struct DayHeader: View {
    let date: String

    var body: some View {
        HStack(alignment: .top) {
            Text(self.date)
                .font(.system(size: 32, weight: .medium, design: .serif))
                .foregroundStyle(LabotaMockPalette.ink)

            Spacer()

            Circle()
                .fill(LabotaMockPalette.ink.opacity(0.08))
                .frame(width: 38, height: 38)
                .overlay {
                    Text("T")
                        .font(.system(size: 16, weight: .bold, design: .rounded))
                        .foregroundStyle(LabotaMockPalette.ink)
                }
        }
        .padding(.horizontal, 22)
        .padding(.top, 16)
    }
}

// MARK: - Nabu Brief (unified AI message card)
//
// Pure message + action. Same visual structure on every screen:
//   1. HEADLINE  — AI's key message (always present, always same typography)
//   2. ACTION    — primary CTA capsule + optional dismiss text
//
// Severity drives the background tint:
//   .info     — blue (no problems, just a helpful tip)
//   .warning  — amber (something needs attention / prep)
//   .urgent   — red (conflicts, overload, needs resolution)

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

    @State private var offset: CGFloat = 0
    @State private var dismissed = false

    var body: some View {
        if !self.dismissed {
            VStack(alignment: .trailing, spacing: 8) {
                Text(self.headline)
                    .font(.system(size: 16, weight: .semibold, design: .rounded))
                    .foregroundStyle(LabotaMockPalette.ink.opacity(0.85))
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)

                if let action = self.actionLabel {
                    Text(action)
                        .font(.system(size: 13, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 9)
                        .background(LabotaMockPalette.ink, in: Capsule())
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(self.severity.tint.opacity(self.severity.bgOpacity))
            )
            .overlay {
                if self.severity.borderOpacity > 0 {
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .stroke(self.severity.tint.opacity(self.severity.borderOpacity), lineWidth: 1)
                }
            }
            .offset(x: self.offset)
            .gesture(
                DragGesture()
                    .onChanged { value in
                        if value.translation.width < 0 {
                            self.offset = value.translation.width
                        }
                    }
                    .onEnded { value in
                        if value.translation.width < -100 {
                            withAnimation(.easeOut(duration: 0.25)) {
                                self.offset = -500
                            }
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                                self.dismissed = true
                            }
                        } else {
                            withAnimation(.spring(response: 0.3)) {
                                self.offset = 0
                            }
                        }
                    }
            )
        }
    }
}

// MARK: - NOW indicator

private struct NowIndicator: View {
    var time: String = "11:45"

    var body: some View {
        HStack(spacing: 10) {
            Circle()
                .fill(LabotaMockPalette.accent)
                .frame(width: 8, height: 8)

            Text("Now · \(self.time)")
                .font(.system(size: 12, weight: .bold, design: .rounded))
                .foregroundStyle(LabotaMockPalette.accent)
                .textCase(.uppercase)
                .tracking(0.6)

            VStack { Divider().background(LabotaMockPalette.accent.opacity(0.4)) }
        }
    }
}


private struct TodayEvent: Identifiable {
    let id = UUID()
    let start: String
    let end: String
    let title: String
    let place: String
    let priority: EventPriority
    var type: EventType = .meeting
    var isPast: Bool = false
}

private enum EventPriority {
    case high
    case medium
    case low

    var label: String {
        switch self {
        case .high:
            "High"
        case .medium:
            "Medium"
        case .low:
            "Low"
        }
    }

    var color: Color {
        switch self {
        case .high:
            LabotaMockPalette.priorityHigh
        case .medium:
            LabotaMockPalette.priorityMedium
        case .low:
            LabotaMockPalette.priorityLow
        }
    }
}

private enum EventType {
    case meeting
    case oneOnOne
    case strategic
    case focus
    case personal

    var label: String {
        switch self {
        case .meeting: "Meeting"
        case .oneOnOne: "1:1"
        case .strategic: "Strategic"
        case .focus: "Focus time"
        case .personal: "Personal"
        }
    }

    var icon: String {
        switch self {
        case .meeting: "person.3"
        case .oneOnOne: "person.2"
        case .strategic: "target"
        case .focus: "brain.head.profile"
        case .personal: "heart"
        }
    }
}

private struct TodayEventCard: View {
    let event: TodayEvent

    private var isHighPriority: Bool {
        self.event.priority == .high
    }

    private var cardHeight: CGFloat {
        if self.event.isPast { return 68 }
        if self.isHighPriority { return 100 }
        return 80
    }

    private var titleSize: CGFloat {
        if self.event.isPast { return 15 }
        if self.isHighPriority { return 19 }
        return 16
    }

    private var dimFactor: Double {
        self.event.isPast ? 0.45 : 1.0
    }

    private var borderWidth: CGFloat {
        if self.event.isPast { return 0 }
        if self.event.priority == .high { return 1.5 }
        return 1
    }

    private var borderColor: Color {
        if self.event.isPast { return .clear }
        if self.event.priority == .high { return self.event.priority.color.opacity(0.4) }
        return LabotaMockPalette.ink.opacity(0.1)
    }

    private var leftAccentWidth: CGFloat {
        if self.event.isPast { return 2 }
        if self.isHighPriority { return 4 }
        return 3
    }

    private var cornerRadius: CGFloat {
        self.event.isPast ? 14 : 18
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            // Time column
            VStack(alignment: .trailing, spacing: 2) {
                Text(self.event.start)
                    .font(.system(size: self.event.isPast ? 11 : 13, weight: .bold, design: .rounded))
                    .foregroundStyle(LabotaMockPalette.ink.opacity(self.event.isPast ? 0.3 : 0.55))
                Text(self.event.end)
                    .font(.system(size: 11, weight: .medium, design: .rounded))
                    .foregroundStyle(LabotaMockPalette.ink.opacity(self.event.isPast ? 0.2 : 0.3))
            }
            .frame(width: 42, alignment: .trailing)
            .padding(.top, self.event.isPast ? 6 : 14)

            // Card
            HStack(spacing: 0) {
                // Left accent bar — color = priority
                Rectangle()
                    .fill(self.event.priority.color.opacity(self.dimFactor))
                    .frame(width: self.leftAccentWidth)

                // Content
                HStack(spacing: 0) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(self.event.title)
                            .font(.system(size: self.titleSize, weight: .semibold, design: .rounded))
                            .foregroundStyle(LabotaMockPalette.ink.opacity(self.dimFactor))
                            .lineLimit(2)

                        if !self.event.isPast {
                            Text("\(self.event.type.label) · \(self.event.place)")
                                .font(.system(size: 13, weight: .medium, design: .rounded))
                                .foregroundStyle(LabotaMockPalette.ink.opacity(0.45))
                                .lineLimit(1)
                        }
                    }

                    Spacer(minLength: 0)

                    if self.event.isPast {
                        Image(systemName: "checkmark")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(LabotaMockPalette.ink.opacity(0.2))
                    }
                }
                .padding(.leading, 12)
                .padding(.trailing, 14)
                .padding(.vertical, self.event.isPast ? 8 : 12)
            }
            .frame(height: self.cardHeight)
            .background(.white.opacity(self.event.isPast ? 0.4 : 0.75))
            .clipShape(RoundedRectangle(cornerRadius: self.cornerRadius, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: self.cornerRadius, style: .continuous)
                    .stroke(self.borderColor, lineWidth: self.borderWidth)
            }
        }
    }
}

private struct PriorityPill: View {
    let text: String
    let color: Color

    var body: some View {
        Text(self.text)
            .font(.system(size: 11, weight: .bold, design: .rounded))
            .foregroundStyle(self.color)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(self.color.opacity(0.14), in: Capsule())
    }
}

private struct ActionTile: View {
    let icon: String
    let title: String

    var body: some View {
        RoundedRectangle(cornerRadius: 18, style: .continuous)
            .fill(.white.opacity(0.7))
            .overlay {
                VStack(alignment: .leading, spacing: 8) {
                    Image(systemName: self.icon)
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(LabotaMockPalette.ink.opacity(0.88))
                    Text(self.title)
                        .font(.system(size: 15, weight: .semibold, design: .rounded))
                        .foregroundStyle(LabotaMockPalette.ink)
                        .multilineTextAlignment(.leading)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(14)
            }
            .overlay {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(LabotaMockPalette.ink.opacity(0.1), lineWidth: 1)
            }
            .frame(height: 90)
    }
}

private struct ChatBubble: View {
    enum Style {
        case user
        case assistant
    }

    let text: String
    let style: Style

    var body: some View {
        HStack {
            if self.style == .assistant {
                self.bubble
                Spacer(minLength: 36)
            } else {
                Spacer(minLength: 36)
                self.bubble
            }
        }
    }

    private var bubble: some View {
        Text(self.text)
            .font(.system(size: 15, weight: .medium, design: .rounded))
            .foregroundStyle(self.style == .assistant ? LabotaMockPalette.ink : .white)
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(self.style == .assistant ? .white.opacity(0.72) : LabotaMockPalette.ink, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(
                        self.style == .assistant ? LabotaMockPalette.ink.opacity(0.1) : .clear,
                        lineWidth: 1)
            }
    }
}

private struct ModeRow: View {
    var icon: String = ""
    let title: String
    let subtitle: String
    let selected: Bool

    var body: some View {
        RoundedRectangle(cornerRadius: 16, style: .continuous)
            .fill(self.selected ? LabotaMockPalette.lavender.opacity(0.95) : .white.opacity(0.74))
            .overlay {
                HStack(spacing: 12) {
                    // Radio button with optional icon overlay
                    ZStack {
                        Circle()
                            .stroke(self.selected ? LabotaMockPalette.ink : LabotaMockPalette.ink.opacity(0.25), lineWidth: 2)
                            .overlay {
                                if self.selected {
                                    Circle()
                                        .fill(LabotaMockPalette.ink)
                                        .padding(4)
                                }
                            }
                            .frame(width: 24, height: 24)
                    }

                    if !self.icon.isEmpty {
                        Image(systemName: self.icon)
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(self.selected ? LabotaMockPalette.ink : LabotaMockPalette.ink.opacity(0.45))
                            .frame(width: 22)
                    }

                    VStack(alignment: .leading, spacing: 2) {
                        Text(self.title)
                            .font(.system(size: 16, weight: .semibold, design: .rounded))
                            .foregroundStyle(LabotaMockPalette.ink)
                        Text(self.subtitle)
                            .font(.system(size: 12, weight: .medium, design: .rounded))
                            .foregroundStyle(LabotaMockPalette.ink.opacity(0.55))
                    }

                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
            }
            .overlay {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(self.selected ? LabotaMockPalette.ink.opacity(0.2) : LabotaMockPalette.ink.opacity(0.1), lineWidth: 1)
            }
            .frame(height: 74)
    }
}

private struct MockPrimaryButton: View {
    enum Style {
        case lavender
        case dark
        case outline
    }

    let title: String
    let style: Style

    var body: some View {
        Text(self.title)
            .font(.system(size: 18, weight: .bold, design: .rounded))
            .foregroundStyle(self.textColor)
            .frame(maxWidth: .infinity)
            .frame(height: 58)
            .background(self.backgroundColor, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(self.borderColor, lineWidth: 2)
            }
    }

    private var backgroundColor: Color {
        switch self.style {
        case .lavender:
            LabotaMockPalette.lavender
        case .dark:
            LabotaMockPalette.ink
        case .outline:
            .clear
        }
    }

    private var textColor: Color {
        switch self.style {
        case .dark:
            .white
        case .lavender, .outline:
            LabotaMockPalette.ink
        }
    }

    private var borderColor: Color {
        switch self.style {
        case .outline:
            LabotaMockPalette.ink.opacity(0.4)
        case .lavender, .dark:
            LabotaMockPalette.ink
        }
    }
}

// MARK: - Screen 07: Empty Day

private struct EmptyDayMockupScreen: View {
    var body: some View {
        MockScreenContainer {
            VStack(alignment: .leading, spacing: 0) {
                DayHeader(date: "Saturday, Mar 1")

                Spacer()

                // Empty state — positive framing
                VStack(spacing: 16) {
                    Text("☀️")
                        .font(.system(size: 56))

                    Text("Nothing planned")
                        .font(.system(size: 28, weight: .medium, design: .serif))
                        .foregroundStyle(LabotaMockPalette.ink)

                    Text("A free day. Rest, plan something,\nor let Nabu find the best restaurant.")
                        .font(.system(size: 16, weight: .medium, design: .rounded))
                        .foregroundStyle(LabotaMockPalette.ink.opacity(0.55))
                        .multilineTextAlignment(.center)
                        .lineSpacing(3)
                        .padding(.horizontal, 20)
                }
                .frame(maxWidth: .infinity)

                Spacer()

                // Subtle CTA
                HStack(spacing: 10) {
                    MockCompactButton(icon: "plus", title: "Add event")
                    MockCompactButton(icon: "message.fill", title: "Ask Nabu")
                }
                .padding(.horizontal, 22)
                .padding(.bottom, 24)
            }
        }
    }
}

private struct MockCompactButton: View {
    let icon: String
    let title: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: self.icon)
                .font(.system(size: 13, weight: .bold))
            Text(self.title)
                .font(.system(size: 15, weight: .semibold, design: .rounded))
        }
        .foregroundStyle(LabotaMockPalette.ink)
        .frame(maxWidth: .infinity)
        .frame(height: 50)
        .background(LabotaMockPalette.ink.opacity(0.06), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(LabotaMockPalette.ink.opacity(0.1), lineWidth: 1)
        }
    }
}

// MARK: - Screen 08: Bot Activity Toast

private struct BotActivityMockupScreen: View {
    var body: some View {
        MockScreenContainer {
            VStack(alignment: .leading, spacing: 0) {
                DayHeader(date: "Thursday, Feb 26")

                // Bot activity toast — appears when bot did something
                BotActivityToast(
                    message: "Added \"Dinner at Sage\" at 19:00",
                    timeAgo: "2 min ago")
                    .padding(.horizontal, 22)
                    .padding(.top, 14)

                // One event card to show context
                HStack(alignment: .top, spacing: 12) {
                    Text("19:00")
                        .font(.system(size: 13, weight: .bold, design: .rounded))
                        .foregroundStyle(LabotaMockPalette.ink.opacity(0.55))
                        .frame(width: 42, alignment: .trailing)
                        .padding(.top, 14)

                    HStack(spacing: 0) {
                        Rectangle()
                            .fill(LabotaMockPalette.accent.opacity(0.5))
                            .frame(width: 4)

                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                HStack(spacing: 6) {
                                    Text("Dinner at Sage")
                                        .font(.system(size: 17, weight: .semibold, design: .rounded))
                                        .foregroundStyle(LabotaMockPalette.ink)

                                    Text("NEW")
                                        .font(.system(size: 9, weight: .heavy, design: .rounded))
                                        .foregroundStyle(.white)
                                        .padding(.horizontal, 6)
                                        .padding(.vertical, 3)
                                        .background(LabotaMockPalette.accent, in: Capsule())
                                }

                                Text("Sage, Bolshaya Sadovaya, 5")
                                    .font(.system(size: 13, weight: .medium, design: .rounded))
                                    .foregroundStyle(LabotaMockPalette.ink.opacity(0.5))

                                HStack(spacing: 4) {
                                    Image(systemName: "sparkles")
                                        .font(.system(size: 10, weight: .bold))
                                        .foregroundStyle(LabotaMockPalette.accent)
                                    Text("Added by Nabu")
                                        .font(.system(size: 11, weight: .semibold, design: .rounded))
                                        .foregroundStyle(LabotaMockPalette.ink.opacity(0.4))
                                }
                            }

                            Spacer(minLength: 0)
                        }
                        .padding(.leading, 14)
                        .padding(.trailing, 14)
                    }
                    .frame(height: 100)
                    .background(.white.opacity(0.75))
                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .stroke(LabotaMockPalette.accent.opacity(0.3), lineWidth: 1.5)
                    }
                }
                .padding(.horizontal, 22)
                .padding(.top, 12)

                Spacer()

                // Audit trail CTA
                HStack {
                    Spacer()
                    HStack(spacing: 6) {
                        Image(systemName: "list.bullet.clipboard")
                            .font(.system(size: 13, weight: .semibold))
                        Text("View all Nabu actions")
                            .font(.system(size: 14, weight: .semibold, design: .rounded))
                    }
                    .foregroundStyle(LabotaMockPalette.ink.opacity(0.45))
                    Spacer()
                }
                .padding(.bottom, 24)
            }
        }
    }
}

private struct BotActivityToast: View {
    let message: String
    let timeAgo: String

    var body: some View {
        RoundedRectangle(cornerRadius: 16, style: .continuous)
            .fill(LabotaMockPalette.accent.opacity(0.12))
            .overlay {
                HStack(spacing: 10) {
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(LabotaMockPalette.accent.opacity(0.2))
                        .frame(width: 32, height: 32)
                        .overlay {
                            Image(systemName: "sparkles")
                                .font(.system(size: 13, weight: .bold))
                                .foregroundStyle(LabotaMockPalette.accent)
                        }

                    VStack(alignment: .leading, spacing: 2) {
                        Text(self.message)
                            .font(.system(size: 14, weight: .semibold, design: .rounded))
                            .foregroundStyle(LabotaMockPalette.ink)
                        Text(self.timeAgo)
                            .font(.system(size: 11, weight: .medium, design: .rounded))
                            .foregroundStyle(LabotaMockPalette.ink.opacity(0.45))
                    }

                    Spacer(minLength: 0)

                    Text("Undo")
                        .font(.system(size: 13, weight: .bold, design: .rounded))
                        .foregroundStyle(LabotaMockPalette.accent)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                        .background(LabotaMockPalette.accent.opacity(0.15), in: Capsule())
                }
                .padding(.horizontal, 14)
            }
            .overlay {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(LabotaMockPalette.accent.opacity(0.2), lineWidth: 1)
            }
            .frame(height: 56)
    }
}

// MARK: - Screen 09: In-App Chat

private struct InAppChatMockupScreen: View {
    var body: some View {
        MockScreenContainer {
            VStack(spacing: 0) {
                // Nav bar
                HStack(spacing: 12) {
                    RoundedRectangle(cornerRadius: 999)
                        .fill(LabotaMockPalette.ink.opacity(0.08))
                        .frame(width: 38, height: 38)
                        .overlay {
                            Image(systemName: "chevron.left")
                                .font(.system(size: 17, weight: .semibold))
                                .foregroundStyle(LabotaMockPalette.ink)
                        }

                    VStack(alignment: .leading, spacing: 1) {
                        Text("Nabu")
                            .font(.system(size: 17, weight: .bold, design: .rounded))
                            .foregroundStyle(LabotaMockPalette.ink)
                        Text("Online")
                            .font(.system(size: 12, weight: .medium, design: .rounded))
                            .foregroundStyle(LabotaMockPalette.success)
                    }

                    Spacer()

                    Circle()
                        .fill(LabotaMockPalette.lavender.opacity(0.5))
                        .frame(width: 36, height: 36)
                        .overlay {
                            Image(systemName: "calendar")
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(LabotaMockPalette.ink.opacity(0.7))
                        }
                }
                .padding(.horizontal, 22)
                .padding(.top, 14)
                .padding(.bottom, 12)

                Divider()
                    .foregroundStyle(LabotaMockPalette.ink.opacity(0.08))

                // Chat messages
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 14) {
                        // Date separator
                        Text("Today")
                            .font(.system(size: 12, weight: .semibold, design: .rounded))
                            .foregroundStyle(LabotaMockPalette.ink.opacity(0.3))
                            .padding(.top, 8)

                        ChatBubble(
                            text: "Move my 15:00 meeting to tomorrow same time",
                            style: .user)

                        ChatBubble(
                            text: "Done. Moved \"Presentation prep\" to Friday, Feb 28 at 15:00. Participants notified.",
                            style: .assistant)

                        ChatBubble(
                            text: "What's my next free slot today?",
                            style: .user)

                        ChatBubble(
                            text: "You're free from 15:00 to 18:30. Want me to block focus time?",
                            style: .assistant)

                        ChatBubble(
                            text: "Yes, block 15:00–17:00 for deep work",
                            style: .user)

                        ChatBubble(
                            text: "Added \"Focus time\" from 15:00 to 17:00. Notifications silenced for that slot.",
                            style: .assistant)
                    }
                    .padding(.horizontal, 22)
                    .padding(.bottom, 16)
                }

                // Input bar
                HStack(spacing: 12) {
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .fill(LabotaMockPalette.ink.opacity(0.05))
                        .frame(height: 44)
                        .overlay {
                            HStack {
                                Text("Message Nabu...")
                                    .font(.system(size: 15, weight: .medium, design: .rounded))
                                    .foregroundStyle(LabotaMockPalette.ink.opacity(0.32))
                                Spacer()
                            }
                            .padding(.horizontal, 16)
                        }
                        .overlay {
                            RoundedRectangle(cornerRadius: 22, style: .continuous)
                                .stroke(LabotaMockPalette.ink.opacity(0.08), lineWidth: 1)
                        }

                    Circle()
                        .fill(LabotaMockPalette.ink)
                        .frame(width: 44, height: 44)
                        .overlay {
                            Image(systemName: "mic.fill")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(.white)
                        }
                }
                .padding(.horizontal, 22)
                .padding(.vertical, 12)
            }
        }
    }
}


private struct ConflictSlotHeader: View {
    let time: String
    let count: Int
    let isNearest: Bool

    var body: some View {
        HStack(spacing: 8) {
            if self.isNearest {
                Text("NOW")
                    .font(.system(size: 10, weight: .heavy, design: .rounded))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(LabotaMockPalette.critical, in: Capsule())
            }
            Text(self.time)
                .font(.system(size: 13, weight: .bold, design: .rounded))
                .foregroundStyle(self.isNearest ? LabotaMockPalette.critical : LabotaMockPalette.ink.opacity(0.4))
            Text("· \(self.count) meetings")
                .font(.system(size: 12, weight: .medium, design: .rounded))
                .foregroundStyle(LabotaMockPalette.ink.opacity(0.3))
            VStack { Divider() }
        }
        .padding(.top, self.isNearest ? 2 : 10)
    }
}

private enum ConflictAction {
    case keep, decline, move

    var label: String {
        switch self {
        case .keep: "Keep"
        case .decline: "Decline"
        case .move: "Move"
        }
    }

    var color: Color {
        switch self {
        case .keep: LabotaMockPalette.success
        case .decline: LabotaMockPalette.critical
        case .move: LabotaMockPalette.strategic
        }
    }

    var icon: String {
        switch self {
        case .keep: "checkmark.circle.fill"
        case .decline: "xmark.circle.fill"
        case .move: "arrow.right.circle.fill"
        }
    }
}

private struct ConflictCard: View {
    let title: String
    let time: String
    let place: String
    let action: ConflictAction
    let reason: String

    var body: some View {
        HStack(spacing: 0) {
            // Left accent bar
            Rectangle()
                .fill(self.action.color.opacity(0.5))
                .frame(width: 3)

            HStack(spacing: 12) {
                // Action icon
                Image(systemName: self.action.icon)
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(self.action.color)
                    .frame(width: 28)

                VStack(alignment: .leading, spacing: 3) {
                    Text(self.title)
                        .font(.system(size: 15, weight: .semibold, design: .rounded))
                        .foregroundStyle(LabotaMockPalette.ink.opacity(self.action == .decline ? 0.5 : 1.0))
                        .strikethrough(self.action == .decline, color: LabotaMockPalette.ink.opacity(0.3))
                        .lineLimit(1)

                    HStack(spacing: 8) {
                        Text(self.time)
                            .font(.system(size: 12, weight: .semibold, design: .rounded))
                            .foregroundStyle(LabotaMockPalette.ink.opacity(0.4))
                        Text(self.place)
                            .font(.system(size: 12, weight: .medium, design: .rounded))
                            .foregroundStyle(LabotaMockPalette.ink.opacity(0.35))
                            .lineLimit(1)
                    }

                    Text(self.reason)
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundStyle(self.action.color.opacity(0.8))
                        .italic()
                }

                Spacer(minLength: 0)

                // Action pill
                Text(self.action.label)
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundStyle(self.action.color)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(self.action.color.opacity(0.1), in: Capsule())
            }
            .padding(.leading, 12)
            .padding(.trailing, 14)
            .padding(.vertical, 12)
        }
        .background(.white.opacity(0.7))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(LabotaMockPalette.ink.opacity(0.08), lineWidth: 1)
        }
    }
}

// MARK: - Screen: Overloaded Day (Tier 1 — too many meetings)



private enum LabotaMockPalette {
    static let canvas = Color(red: 0.93, green: 0.93, blue: 0.95)
    static let screen = Color(red: 0.95, green: 0.95, blue: 0.96)

    static let ink = Color(red: 0.18, green: 0.16, blue: 0.23)
    static let accent = Color(red: 0.93, green: 0.63, blue: 0.28)
    static let lavender = Color(red: 0.82, green: 0.74, blue: 0.89)
    static let cloudBlue = Color(red: 0.76, green: 0.87, blue: 0.95)

    static let google = Color(red: 0.23, green: 0.46, blue: 0.90)
    static let success = Color(red: 0.18, green: 0.57, blue: 0.31)
    static let warning = Color(red: 0.95, green: 0.56, blue: 0.25)
    // Semantic action colors (used in conflict cards, action rows, etc.)
    static let critical = Color(red: 0.83, green: 0.28, blue: 0.26)
    static let strategic = Color(red: 0.20, green: 0.48, blue: 0.82)

    // 3-level priority colors — accent bar + type label
    static let priorityHigh = Color(red: 0.83, green: 0.28, blue: 0.26)   // warm red
    static let priorityMedium = Color(red: 0.86, green: 0.56, blue: 0.22) // amber
    static let priorityLow = Color(red: 0.58, green: 0.58, blue: 0.62)    // neutral gray
}

#Preview("Nabu Calendar Mockups") {
    LabotaCalendarMockupsView()
}
