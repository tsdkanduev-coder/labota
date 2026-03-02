import SwiftUI

struct LabotaCalendarMockupsView: View {
    var body: some View {
        ScrollView {
            VStack(spacing: 28) {
                MockupSection(title: "01. Onboarding / Promise") {
                    WelcomeMockupScreen()
                }

                MockupSection(title: "02. Connect Calendars") {
                    ConnectCalendarsMockupScreen()
                }

                MockupSection(title: "03. Permission / Consent") {
                    PermissionMockupScreen()
                }

                MockupSection(title: "04. Today / AI Prioritized") {
                    TodayMockupScreen()
                }

                MockupSection(title: "05. Event Detail + Contextual AI") {
                    EventDetailsMockupScreen()
                }

                MockupSection(title: "06. Telegram Control Mode") {
                    TelegramControlMockupScreen()
                }

                MockupSection(title: "07. Empty Day") {
                    EmptyDayMockupScreen()
                }

                MockupSection(title: "08. Bot Activity Toast") {
                    BotActivityMockupScreen()
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 24)
        }
        .background(LabotaMockPalette.canvas.ignoresSafeArea())
        .navigationTitle("Labota Calendar Mockups")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct MockupSection<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.system(size: 15, weight: .semibold, design: .rounded))
                .foregroundStyle(LabotaMockPalette.ink.opacity(0.84))
                .padding(.horizontal, 8)

            MockPhoneFrame {
                content
            }
        }
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

                VStack(spacing: 6) {
                    Text("Every meeting in one place.")
                        .foregroundStyle(LabotaMockPalette.ink.opacity(0.72))
                    Text("Priorities set by AI.")
                        .foregroundStyle(LabotaMockPalette.ink.opacity(0.72))
                }
                .font(.system(size: 19, weight: .medium, design: .rounded))
                .multilineTextAlignment(.center)
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

                Text("Connect your calendars\nto Labota")
                    .font(.system(size: 50, weight: .medium, design: .serif))
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

                Text("Your calendar data stays private. You can disable access anytime in Settings.")
                    .font(.system(size: 16, weight: .medium, design: .rounded))
                    .foregroundStyle(LabotaMockPalette.ink.opacity(0.62))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 28)

                MockPrimaryButton(
                    title: "Continue",
                    style: .dark)
                    .padding(.horizontal, 22)
                    .padding(.top, 18)
                    .padding(.bottom, 22)
            }
        }
    }
}

private struct PermissionMockupScreen: View {
    var body: some View {
        MockScreenContainer {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 12) {
                    RoundedRectangle(cornerRadius: 999)
                        .fill(LabotaMockPalette.ink.opacity(0.1))
                        .frame(width: 40, height: 40)
                        .overlay {
                            Image(systemName: "chevron.left")
                                .font(.system(size: 18, weight: .semibold))
                                .foregroundStyle(LabotaMockPalette.ink)
                        }

                    Text("Permissions")
                        .font(.system(size: 22, weight: .semibold, design: .rounded))
                        .foregroundStyle(LabotaMockPalette.ink)
                }
                .padding(.horizontal, 22)
                .padding(.top, 20)

                Text("Allow calendar access")
                    .font(.system(size: 50, weight: .medium, design: .serif))
                    .foregroundStyle(LabotaMockPalette.ink)
                    .padding(.horizontal, 22)
                    .padding(.top, 18)

                Text("Labota uses this to sync your schedule,\nfind conflicts, and suggest the best slots.")
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
            priority: .critical,
            isPast: true),
        TodayEvent(
            start: "11:00",
            end: "11:30",
            title: "1:1 with Product Lead",
            place: "Google Meet",
            priority: .important,
            isPast: true),
        TodayEvent(
            start: "13:00",
            end: "14:30",
            title: "Client lunch reservation",
            place: "SHE Belorusskaya · 4 guests",
            priority: .strategic,
            isPast: false),
        TodayEvent(
            start: "15:00",
            end: "17:00",
            title: "Presentation prep",
            place: "Focus time · Deep work",
            priority: .low,
            isPast: false),
        TodayEvent(
            start: "18:30",
            end: "19:00",
            title: "Gym",
            place: "Personal",
            priority: .low,
            isPast: false),
    ]

    var body: some View {
        MockScreenContainer {
            VStack(alignment: .leading, spacing: 0) {
                // Header
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Thursday, Feb 26")
                            .font(.system(size: 15, weight: .medium, design: .rounded))
                            .foregroundStyle(LabotaMockPalette.ink.opacity(0.55))

                        Text("Your day")
                            .font(.system(size: 40, weight: .medium, design: .serif))
                            .foregroundStyle(LabotaMockPalette.ink)
                    }

                    Spacer()

                    Circle()
                        .fill(LabotaMockPalette.ink.opacity(0.08))
                        .frame(width: 42, height: 42)
                        .overlay {
                            Text("T")
                                .font(.system(size: 17, weight: .bold, design: .rounded))
                                .foregroundStyle(LabotaMockPalette.ink)
                        }
                }
                .padding(.horizontal, 22)
                .padding(.top, 18)

                // Cloud brief — organic shape
                CloudBriefView()
                    .padding(.horizontal, 22)
                    .padding(.top, 14)

                // Timeline
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 0) {
                        // Past events — dimmed
                        ForEach(self.events.filter(\.isPast)) { event in
                            TodayEventCard(event: event)
                                .padding(.bottom, 8)
                        }

                        // NOW indicator
                        NowIndicator()
                            .padding(.vertical, 6)

                        // Upcoming events — full intensity, size by priority
                        ForEach(self.events.filter { !$0.isPast }) { event in
                            TodayEventCard(event: event)
                                .padding(.bottom, 8)
                        }
                    }
                    .padding(.horizontal, 22)
                    .padding(.top, 10)
                    .padding(.bottom, 16)
                }
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
                                PriorityPill(text: "Strategic", color: LabotaMockPalette.strategic)
                                PriorityPill(text: "40 min commute", color: LabotaMockPalette.warning)
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
                    Text("Labota suggests")
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
                        icon: "phone.fill",
                        title: "Confirm reservation",
                        subtitle: "Call SHE to reconfirm 4 guests",
                        accentColor: LabotaMockPalette.success)
                }
                .padding(.horizontal, 22)
                .padding(.top, 10)

                Spacer(minLength: 14)

                Text("All actions require your confirmation in Telegram.")
                    .font(.system(size: 13, weight: .medium, design: .rounded))
                    .foregroundStyle(LabotaMockPalette.ink.opacity(0.42))
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.horizontal, 22)
                    .padding(.bottom, 20)
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
        RoundedRectangle(cornerRadius: 16, style: .continuous)
            .fill(.white.opacity(0.7))
            .overlay(alignment: .leading) {
                UnevenRoundedRectangle(
                    topLeadingRadius: 16,
                    bottomLeadingRadius: 16,
                    bottomTrailingRadius: 0,
                    topTrailingRadius: 0)
                    .fill(self.accentColor.opacity(0.25))
                    .frame(width: 3)
            }
            .overlay {
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
                .padding(.leading, 14)
                .padding(.trailing, 14)
            }
            .overlay {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(LabotaMockPalette.ink.opacity(0.08), lineWidth: 1)
            }
            .frame(height: 64)
    }
}

private struct TelegramControlMockupScreen: View {
    var body: some View {
        MockScreenContainer {
            VStack(alignment: .leading, spacing: 0) {
                Text("Labota in Telegram")
                    .font(.system(size: 50, weight: .medium, design: .serif))
                    .foregroundStyle(LabotaMockPalette.ink)
                    .padding(.horizontal, 22)
                    .padding(.top, 22)

                Text("Your assistant can schedule and move meetings while you chat.")
                    .font(.system(size: 17, weight: .medium, design: .rounded))
                    .foregroundStyle(LabotaMockPalette.ink.opacity(0.72))
                    .padding(.horizontal, 22)
                    .padding(.top, 10)

                VStack(spacing: 10) {
                    ChatBubble(
                        text: "Book HITE for Friday 20:00 and add it to my calendar.",
                        style: .user)

                    ChatBubble(
                        text: "Done. Added event + set reminder for 18:30. Want me to call and confirm?",
                        style: .assistant)
                }
                .padding(.horizontal, 22)
                .padding(.top, 18)

                Text("Control mode")
                    .font(.system(size: 17, weight: .semibold, design: .rounded))
                    .foregroundStyle(LabotaMockPalette.ink.opacity(0.82))
                    .padding(.horizontal, 22)
                    .padding(.top, 20)

                VStack(spacing: 10) {
                    ModeRow(
                        title: "Read-only",
                        subtitle: "Can summarize and suggest only",
                        selected: false)
                    ModeRow(
                        title: "Suggest-only",
                        subtitle: "Prepares drafts, you tap to apply",
                        selected: false)
                    ModeRow(
                        title: "Act with confirmation",
                        subtitle: "Default for personal assistant flow",
                        selected: true)
                }
                .padding(.horizontal, 22)
                .padding(.top, 10)

                Spacer(minLength: 16)

                MockPrimaryButton(
                    title: "Save mode",
                    style: .lavender)
                    .padding(.horizontal, 22)

                // Audit log link — trust signal
                HStack {
                    Spacer()
                    HStack(spacing: 6) {
                        Image(systemName: "list.bullet.clipboard")
                            .font(.system(size: 12, weight: .semibold))
                        Text("View action history")
                            .font(.system(size: 14, weight: .semibold, design: .rounded))
                    }
                    .foregroundStyle(LabotaMockPalette.ink.opacity(0.42))
                    Spacer()
                }
                .padding(.top, 14)
                .padding(.bottom, 20)
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

// MARK: - Cloud Brief (organic, alive)

private struct CloudBriefView: View {
    var body: some View {
        ZStack {
            // Soft organic background — layered ellipses for cloud feel
            ZStack {
                Ellipse()
                    .fill(LabotaMockPalette.cloudBlue.opacity(0.55))
                    .frame(width: 320, height: 140)
                    .offset(x: -10, y: 8)
                    .blur(radius: 1)

                Ellipse()
                    .fill(LabotaMockPalette.lavender.opacity(0.50))
                    .frame(width: 280, height: 120)
                    .offset(x: 20, y: -4)
                    .blur(radius: 1)

                Ellipse()
                    .fill(LabotaMockPalette.cloudBlue.opacity(0.35))
                    .frame(width: 200, height: 100)
                    .offset(x: -40, y: 14)
                    .blur(radius: 2)
            }

            // Content
            VStack(alignment: .leading, spacing: 7) {
                HStack(spacing: 6) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(LabotaMockPalette.accent)
                    Text("AI brief")
                        .font(.system(size: 12, weight: .bold, design: .rounded))
                        .foregroundStyle(LabotaMockPalette.ink.opacity(0.7))
                        .textCase(.uppercase)
                        .tracking(0.8)
                }

                Text("Two key meetings done. Lunch at 13:00 needs 40 min commute — leave by 12:15.")
                    .font(.system(size: 15, weight: .medium, design: .rounded))
                    .foregroundStyle(LabotaMockPalette.ink.opacity(0.82))
                    .lineSpacing(3)

                Text("Best focus slot: 15:30–17:00")
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(LabotaMockPalette.strategic)
                    .padding(.top, 2)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 16)
        }
        .frame(maxWidth: .infinity)
        .frame(minHeight: 130)
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .stroke(LabotaMockPalette.ink.opacity(0.08), lineWidth: 1)
        }
    }
}

// MARK: - NOW indicator

private struct NowIndicator: View {
    var body: some View {
        HStack(spacing: 10) {
            Circle()
                .fill(LabotaMockPalette.accent)
                .frame(width: 8, height: 8)

            Text("Now · 11:45")
                .font(.system(size: 12, weight: .bold, design: .rounded))
                .foregroundStyle(LabotaMockPalette.accent)
                .textCase(.uppercase)
                .tracking(0.6)

            VStack { Divider().background(LabotaMockPalette.accent.opacity(0.4)) }
        }
    }
}

// Legacy: keep for backward compat if referenced elsewhere
private struct CloudSummaryCard: View {
    let title: String
    let lines: [String]

    var body: some View {
        RoundedRectangle(cornerRadius: 28, style: .continuous)
            .fill(
                LinearGradient(
                    colors: [LabotaMockPalette.cloudBlue, LabotaMockPalette.lavender],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing))
            .overlay {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        Image(systemName: "cloud.fill")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(LabotaMockPalette.ink.opacity(0.84))
                        Text(self.title)
                            .font(.system(size: 14, weight: .bold, design: .rounded))
                            .foregroundStyle(LabotaMockPalette.ink.opacity(0.84))
                    }

                    ForEach(self.lines, id: \.self) { line in
                        Text("• \(line)")
                            .font(.system(size: 13, weight: .medium, design: .rounded))
                            .foregroundStyle(LabotaMockPalette.ink.opacity(0.75))
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
            }
            .overlay {
                RoundedRectangle(cornerRadius: 28, style: .continuous)
                    .stroke(LabotaMockPalette.ink.opacity(0.12), lineWidth: 1)
            }
            .frame(height: 148)
    }
}

private struct TodayEvent: Identifiable {
    let id = UUID()
    let start: String
    let end: String
    let title: String
    let place: String
    let priority: EventPriority
    var isPast: Bool = false
}

private enum EventPriority {
    case critical
    case important
    case strategic
    case low

    var label: String {
        switch self {
        case .critical:
            "Critical"
        case .important:
            "Important"
        case .strategic:
            "Strategic"
        case .low:
            "Low"
        }
    }

    var color: Color {
        switch self {
        case .critical:
            LabotaMockPalette.critical
        case .important:
            LabotaMockPalette.important
        case .strategic:
            LabotaMockPalette.strategic
        case .low:
            LabotaMockPalette.low
        }
    }
}

private struct TodayEventCard: View {
    let event: TodayEvent

    private var isHighPriority: Bool {
        self.event.priority == .critical || self.event.priority == .strategic
    }

    private var cardHeight: CGFloat {
        if self.event.isPast { return 68 }
        if self.isHighPriority { return 110 }
        return 88
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
        if self.event.priority == .critical { return 1.5 }
        return 1
    }

    private var borderColor: Color {
        if self.event.isPast { return .clear }
        if self.event.priority == .critical { return self.event.priority.color.opacity(0.4) }
        return LabotaMockPalette.ink.opacity(0.1)
    }

    private var leftAccentWidth: CGFloat {
        if self.event.isPast { return 2 }
        if self.isHighPriority { return 4 }
        return 3
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            // Time column
            VStack(alignment: .trailing, spacing: 2) {
                Text(self.event.start)
                    .font(.system(size: self.event.isPast ? 11 : 13, weight: .bold, design: .rounded))
                    .foregroundStyle(LabotaMockPalette.ink.opacity(self.event.isPast ? 0.3 : 0.55))
                if !self.event.isPast {
                    Text(self.event.end)
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                        .foregroundStyle(LabotaMockPalette.ink.opacity(0.3))
                }
            }
            .frame(width: 42, alignment: .trailing)
            .padding(.top, self.event.isPast ? 6 : 14)

            // Card
            RoundedRectangle(cornerRadius: self.event.isPast ? 14 : 18, style: .continuous)
                .fill(.white.opacity(self.event.isPast ? 0.4 : 0.75))
                .overlay(alignment: .leading) {
                    // Left accent bar
                    UnevenRoundedRectangle(
                        topLeadingRadius: self.event.isPast ? 14 : 18,
                        bottomLeadingRadius: self.event.isPast ? 14 : 18,
                        bottomTrailingRadius: 0,
                        topTrailingRadius: 0)
                        .fill(self.event.priority.color.opacity(self.dimFactor))
                        .frame(width: self.leftAccentWidth)
                }
                .overlay {
                    HStack(spacing: 0) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(self.event.title)
                                .font(.system(size: self.titleSize, weight: .semibold, design: .rounded))
                                .foregroundStyle(LabotaMockPalette.ink.opacity(self.dimFactor))
                                .lineLimit(2)

                            if !self.event.isPast {
                                Text(self.event.place)
                                    .font(.system(size: 13, weight: .medium, design: .rounded))
                                    .foregroundStyle(LabotaMockPalette.ink.opacity(0.5))
                            }

                            if !self.event.isPast && self.isHighPriority {
                                PriorityPill(
                                    text: self.event.priority.label,
                                    color: self.event.priority.color)
                            }
                        }

                        Spacer(minLength: 0)

                        if self.event.isPast {
                            Image(systemName: "checkmark")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(LabotaMockPalette.ink.opacity(0.2))
                        }
                    }
                    .padding(.leading, self.leftAccentWidth + 12)
                    .padding(.trailing, 14)
                    .padding(.vertical, self.event.isPast ? 8 : 12)
                }
                .overlay {
                    RoundedRectangle(cornerRadius: self.event.isPast ? 14 : 18, style: .continuous)
                        .stroke(self.borderColor, lineWidth: self.borderWidth)
                }
                .frame(height: self.cardHeight)
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
    let title: String
    let subtitle: String
    let selected: Bool

    var body: some View {
        RoundedRectangle(cornerRadius: 16, style: .continuous)
            .fill(self.selected ? LabotaMockPalette.lavender.opacity(0.95) : .white.opacity(0.74))
            .overlay {
                HStack(spacing: 12) {
                    Circle()
                        .stroke(LabotaMockPalette.ink.opacity(0.35), lineWidth: 2)
                        .overlay {
                            if self.selected {
                                Circle()
                                    .fill(LabotaMockPalette.ink)
                                    .padding(4)
                            }
                        }
                        .frame(width: 24, height: 24)

                    VStack(alignment: .leading, spacing: 2) {
                        Text(self.title)
                            .font(.system(size: 16, weight: .semibold, design: .rounded))
                            .foregroundStyle(LabotaMockPalette.ink)
                        Text(self.subtitle)
                            .font(.system(size: 13, weight: .medium, design: .rounded))
                            .foregroundStyle(LabotaMockPalette.ink.opacity(0.66))
                    }

                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
            }
            .overlay {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(LabotaMockPalette.ink.opacity(0.12), lineWidth: 1)
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
                // Same header as Today
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Saturday, Mar 1")
                            .font(.system(size: 15, weight: .medium, design: .rounded))
                            .foregroundStyle(LabotaMockPalette.ink.opacity(0.55))

                        Text("Your day")
                            .font(.system(size: 40, weight: .medium, design: .serif))
                            .foregroundStyle(LabotaMockPalette.ink)
                    }

                    Spacer()

                    Circle()
                        .fill(LabotaMockPalette.ink.opacity(0.08))
                        .frame(width: 42, height: 42)
                        .overlay {
                            Text("T")
                                .font(.system(size: 17, weight: .bold, design: .rounded))
                                .foregroundStyle(LabotaMockPalette.ink)
                        }
                }
                .padding(.horizontal, 22)
                .padding(.top, 18)

                Spacer()

                // Empty state — positive framing
                VStack(spacing: 16) {
                    Text("☀️")
                        .font(.system(size: 56))

                    Text("Nothing planned")
                        .font(.system(size: 28, weight: .medium, design: .serif))
                        .foregroundStyle(LabotaMockPalette.ink)

                    Text("A free day. Rest, plan something,\nor let Labota find the best restaurant.")
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
                    MockCompactButton(icon: "message.fill", title: "Ask Labota")
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
                // Same header
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Thursday, Feb 26")
                            .font(.system(size: 15, weight: .medium, design: .rounded))
                            .foregroundStyle(LabotaMockPalette.ink.opacity(0.55))

                        Text("Your day")
                            .font(.system(size: 40, weight: .medium, design: .serif))
                            .foregroundStyle(LabotaMockPalette.ink)
                    }

                    Spacer()

                    Circle()
                        .fill(LabotaMockPalette.ink.opacity(0.08))
                        .frame(width: 42, height: 42)
                        .overlay {
                            Text("T")
                                .font(.system(size: 17, weight: .bold, design: .rounded))
                                .foregroundStyle(LabotaMockPalette.ink)
                        }
                }
                .padding(.horizontal, 22)
                .padding(.top, 18)

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

                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(.white.opacity(0.75))
                        .overlay(alignment: .leading) {
                            UnevenRoundedRectangle(
                                topLeadingRadius: 18,
                                bottomLeadingRadius: 18,
                                bottomTrailingRadius: 0,
                                topTrailingRadius: 0)
                                .fill(LabotaMockPalette.accent.opacity(0.5))
                                .frame(width: 4)
                        }
                        .overlay {
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                    HStack(spacing: 6) {
                                        Text("Dinner at Sage")
                                            .font(.system(size: 17, weight: .semibold, design: .rounded))
                                            .foregroundStyle(LabotaMockPalette.ink)

                                        // "NEW" indicator
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
                                        Text("Added by Labota")
                                            .font(.system(size: 11, weight: .semibold, design: .rounded))
                                            .foregroundStyle(LabotaMockPalette.ink.opacity(0.4))
                                    }
                                }

                                Spacer(minLength: 0)
                            }
                            .padding(.leading, 18)
                            .padding(.trailing, 14)
                        }
                        .overlay {
                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                .stroke(LabotaMockPalette.accent.opacity(0.3), lineWidth: 1.5)
                        }
                        .frame(height: 100)
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
                        Text("View all Labota actions")
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
    static let critical = Color(red: 0.83, green: 0.28, blue: 0.26)
    static let important = Color(red: 0.86, green: 0.46, blue: 0.21)
    static let strategic = Color(red: 0.20, green: 0.48, blue: 0.82)
    static let low = Color(red: 0.33, green: 0.64, blue: 0.41)
}

#Preview("Labota Calendar Mockups") {
    NavigationStack {
        LabotaCalendarMockupsView()
    }
}
