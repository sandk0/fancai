# iOS Gamification Research for fancai

**Date:** 2026-01-17
**Scope:** Gamification mechanics for iOS book reading app
**Author:** Claude Code

## Executive Summary

This research explores gamification strategies for the fancai iOS book reading app, covering reading statistics tracking, goal setting, streaks, achievements, leaderboards, competitor analysis, and psychological considerations. The report provides concrete Swift/SwiftUI code examples and recommendations for ethical implementation that prioritizes intrinsic motivation over manipulative engagement tactics.

---

## Table of Contents

1. [Reading Statistics](#1-reading-statistics)
2. [Reading Goals](#2-reading-goals)
3. [Streaks](#3-streaks)
4. [Achievements](#4-achievements)
5. [Leaderboards](#5-leaderboards)
6. [Competitor Analysis](#6-competitor-analysis)
7. [Psychology of Gamification](#7-psychology-of-gamification)
8. [Implementation Recommendations](#8-implementation-recommendations)
9. [Sources](#9-sources)

---

## 1. Reading Statistics

### 1.1 Metrics to Track

| Metric | Description | Storage Type |
|--------|-------------|--------------|
| Books completed | Total books finished | Int |
| Pages read | Cumulative pages (daily/weekly/monthly/all-time) | Int |
| Words read | Estimated based on average words per page | Int |
| Reading time | Minutes spent reading | TimeInterval |
| Reading sessions | Number of reading sessions | Int |
| Average session duration | Time per session | TimeInterval |
| Reading speed | Words/pages per minute | Double |
| Current streak | Consecutive days reading | Int |

### 1.2 SwiftData Models

```swift
import SwiftData
import Foundation

@Model
class ReadingSession {
    var id: UUID
    var bookId: UUID
    var startTime: Date
    var endTime: Date
    var pagesRead: Int
    var wordsRead: Int
    var startPage: Int
    var endPage: Int

    var duration: TimeInterval {
        endTime.timeIntervalSince(startTime)
    }

    var wordsPerMinute: Double {
        guard duration > 0 else { return 0 }
        return Double(wordsRead) / (duration / 60)
    }

    init(bookId: UUID, startTime: Date = .now) {
        self.id = UUID()
        self.bookId = bookId
        self.startTime = startTime
        self.endTime = startTime
        self.pagesRead = 0
        self.wordsRead = 0
        self.startPage = 0
        self.endPage = 0
    }
}

@Model
class DailyReadingStats {
    @Attribute(.unique) var date: Date
    var totalMinutes: Int
    var totalPages: Int
    var totalWords: Int
    var sessionsCount: Int
    var booksCompleted: Int

    init(date: Date = Calendar.current.startOfDay(for: .now)) {
        self.date = date
        self.totalMinutes = 0
        self.totalPages = 0
        self.totalWords = 0
        self.sessionsCount = 0
        self.booksCompleted = 0
    }
}

@Model
class UserReadingProfile {
    var id: UUID
    var totalBooksCompleted: Int
    var totalPagesRead: Int
    var totalWordsRead: Int
    var totalReadingMinutes: Int
    var currentStreak: Int
    var longestStreak: Int
    var lastReadingDate: Date?
    var streakFreezes: Int
    var memberSince: Date

    init() {
        self.id = UUID()
        self.totalBooksCompleted = 0
        self.totalPagesRead = 0
        self.totalWordsRead = 0
        self.totalReadingMinutes = 0
        self.currentStreak = 0
        self.longestStreak = 0
        self.lastReadingDate = nil
        self.streakFreezes = 3
        self.memberSince = .now
    }
}
```

### 1.3 Statistics Service

```swift
import SwiftData
import Foundation

@Observable
class ReadingStatsService {
    private let modelContext: ModelContext

    init(modelContext: ModelContext) {
        self.modelContext = modelContext
    }

    // MARK: - Session Tracking

    func startSession(bookId: UUID, startPage: Int) -> ReadingSession {
        let session = ReadingSession(bookId: bookId)
        session.startPage = startPage
        modelContext.insert(session)
        return session
    }

    func endSession(
        _ session: ReadingSession,
        endPage: Int,
        wordsPerPage: Int = 250
    ) {
        session.endTime = .now
        session.endPage = endPage
        session.pagesRead = max(0, endPage - session.startPage)
        session.wordsRead = session.pagesRead * wordsPerPage

        updateDailyStats(with: session)
        updateUserProfile(with: session)

        try? modelContext.save()
    }

    private func updateDailyStats(with session: ReadingSession) {
        let today = Calendar.current.startOfDay(for: .now)

        let descriptor = FetchDescriptor<DailyReadingStats>(
            predicate: #Predicate { $0.date == today }
        )

        let stats: DailyReadingStats
        if let existing = try? modelContext.fetch(descriptor).first {
            stats = existing
        } else {
            stats = DailyReadingStats(date: today)
            modelContext.insert(stats)
        }

        stats.totalMinutes += Int(session.duration / 60)
        stats.totalPages += session.pagesRead
        stats.totalWords += session.wordsRead
        stats.sessionsCount += 1
    }

    private func updateUserProfile(with session: ReadingSession) {
        let descriptor = FetchDescriptor<UserReadingProfile>()
        guard let profile = try? modelContext.fetch(descriptor).first else { return }

        profile.totalPagesRead += session.pagesRead
        profile.totalWordsRead += session.wordsRead
        profile.totalReadingMinutes += Int(session.duration / 60)
        profile.lastReadingDate = .now
    }

    // MARK: - Statistics Queries

    func getWeeklyStats() -> [DailyReadingStats] {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: .now)
        guard let weekAgo = calendar.date(byAdding: .day, value: -7, to: today) else {
            return []
        }

        let descriptor = FetchDescriptor<DailyReadingStats>(
            predicate: #Predicate { $0.date >= weekAgo && $0.date <= today },
            sortBy: [SortDescriptor(\.date)]
        )

        return (try? modelContext.fetch(descriptor)) ?? []
    }

    func getMonthlyStats() -> [DailyReadingStats] {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: .now)
        guard let monthAgo = calendar.date(byAdding: .month, value: -1, to: today) else {
            return []
        }

        let descriptor = FetchDescriptor<DailyReadingStats>(
            predicate: #Predicate { $0.date >= monthAgo && $0.date <= today },
            sortBy: [SortDescriptor(\.date)]
        )

        return (try? modelContext.fetch(descriptor)) ?? []
    }
}
```

### 1.4 Charts Visualization

Swift Charts framework (iOS 16+) provides native, accessible chart rendering with Dark Mode support, VoiceOver, and Audio Graphs.

#### Weekly Reading Time Chart

```swift
import SwiftUI
import Charts

struct WeeklyReadingChart: View {
    let stats: [DailyReadingStats]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("This Week")
                .font(.headline)

            Chart(stats) { day in
                BarMark(
                    x: .value("Day", day.date, unit: .day),
                    y: .value("Minutes", day.totalMinutes)
                )
                .foregroundStyle(
                    .linearGradient(
                        colors: [.blue.opacity(0.6), .blue],
                        startPoint: .bottom,
                        endPoint: .top
                    )
                )
                .cornerRadius(4)
            }
            .chartXAxis {
                AxisMarks(values: .stride(by: .day)) { value in
                    if let date = value.as(Date.self) {
                        AxisValueLabel {
                            Text(date, format: .dateTime.weekday(.abbreviated))
                        }
                    }
                    AxisGridLine()
                }
            }
            .chartYAxis {
                AxisMarks(position: .leading) { value in
                    AxisValueLabel {
                        if let minutes = value.as(Int.self) {
                            Text("\(minutes)m")
                        }
                    }
                    AxisGridLine()
                }
            }
            .frame(height: 200)
        }
        .padding()
    }
}
```

#### Reading Progress Line Chart

```swift
import SwiftUI
import Charts

struct ReadingProgressChart: View {
    let stats: [DailyReadingStats]
    @State private var selectedDate: Date?

    private var cumulativePages: [(date: Date, total: Int)] {
        var cumulative = 0
        return stats.map { stat in
            cumulative += stat.totalPages
            return (stat.date, cumulative)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Pages Read")
                .font(.headline)

            Chart {
                ForEach(cumulativePages, id: \.date) { item in
                    LineMark(
                        x: .value("Date", item.date),
                        y: .value("Pages", item.total)
                    )
                    .interpolationMethod(.catmullRom)
                    .foregroundStyle(.green)

                    AreaMark(
                        x: .value("Date", item.date),
                        y: .value("Pages", item.total)
                    )
                    .interpolationMethod(.catmullRom)
                    .foregroundStyle(
                        .linearGradient(
                            colors: [.green.opacity(0.3), .clear],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                }

                if let selected = selectedDate,
                   let data = cumulativePages.first(where: {
                       Calendar.current.isDate($0.date, inSameDayAs: selected)
                   }) {
                    RuleMark(x: .value("Selected", selected))
                        .foregroundStyle(.gray.opacity(0.5))

                    PointMark(
                        x: .value("Date", data.date),
                        y: .value("Pages", data.total)
                    )
                    .foregroundStyle(.green)
                    .annotation(position: .top) {
                        Text("\(data.total) pages")
                            .font(.caption)
                            .padding(4)
                            .background(.ultraThinMaterial)
                            .cornerRadius(4)
                    }
                }
            }
            .chartXSelection(value: $selectedDate)
            .frame(height: 200)
        }
        .padding()
    }
}
```

#### Statistics Dashboard

```swift
import SwiftUI

struct StatisticsDashboard: View {
    @Environment(\.modelContext) private var modelContext
    @Query private var profile: [UserReadingProfile]

    private var userProfile: UserReadingProfile? {
        profile.first
    }

    var body: some View {
        ScrollView {
            LazyVGrid(columns: [
                GridItem(.flexible()),
                GridItem(.flexible())
            ], spacing: 16) {
                StatCard(
                    title: "Books Read",
                    value: "\(userProfile?.totalBooksCompleted ?? 0)",
                    icon: "book.fill",
                    color: .purple
                )

                StatCard(
                    title: "Pages Read",
                    value: formatNumber(userProfile?.totalPagesRead ?? 0),
                    icon: "doc.text.fill",
                    color: .blue
                )

                StatCard(
                    title: "Reading Time",
                    value: formatDuration(userProfile?.totalReadingMinutes ?? 0),
                    icon: "clock.fill",
                    color: .orange
                )

                StatCard(
                    title: "Current Streak",
                    value: "\(userProfile?.currentStreak ?? 0) days",
                    icon: "flame.fill",
                    color: .red
                )
            }
            .padding()
        }
    }

    private func formatNumber(_ value: Int) -> String {
        if value >= 1000 {
            return String(format: "%.1fK", Double(value) / 1000)
        }
        return "\(value)"
    }

    private func formatDuration(_ minutes: Int) -> String {
        let hours = minutes / 60
        if hours >= 24 {
            let days = hours / 24
            return "\(days)d \(hours % 24)h"
        }
        return "\(hours)h \(minutes % 60)m"
    }
}

struct StatCard: View {
    let title: String
    let value: String
    let icon: String
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: icon)
                    .foregroundStyle(color)
                Spacer()
            }

            Text(value)
                .font(.title2)
                .fontWeight(.bold)

            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding()
        .background(color.opacity(0.1))
        .cornerRadius(12)
    }
}
```

---

## 2. Reading Goals

### 2.1 Goal Types

| Goal Type | Measurement | Typical Periods |
|-----------|-------------|-----------------|
| Time-based | Minutes/hours of reading | Daily, Weekly |
| Pages-based | Number of pages | Daily, Weekly |
| Books-based | Number of books completed | Monthly, Yearly |
| Sessions-based | Number of reading sessions | Daily |

### 2.2 SwiftData Models

```swift
import SwiftData
import Foundation

enum GoalType: String, Codable, CaseIterable {
    case time = "Time"
    case pages = "Pages"
    case books = "Books"
    case sessions = "Sessions"

    var icon: String {
        switch self {
        case .time: return "clock"
        case .pages: return "doc.text"
        case .books: return "book"
        case .sessions: return "calendar"
        }
    }

    var unit: String {
        switch self {
        case .time: return "minutes"
        case .pages: return "pages"
        case .books: return "books"
        case .sessions: return "sessions"
        }
    }
}

enum GoalPeriod: String, Codable, CaseIterable {
    case daily = "Daily"
    case weekly = "Weekly"
    case monthly = "Monthly"
    case yearly = "Yearly"

    var calendarComponent: Calendar.Component {
        switch self {
        case .daily: return .day
        case .weekly: return .weekOfYear
        case .monthly: return .month
        case .yearly: return .year
        }
    }
}

@Model
class ReadingGoal {
    var id: UUID
    var type: GoalType
    var period: GoalPeriod
    var target: Int
    var currentProgress: Int
    var startDate: Date
    var isActive: Bool
    var reminderEnabled: Bool
    var reminderTime: Date?

    var progressPercentage: Double {
        guard target > 0 else { return 0 }
        return min(Double(currentProgress) / Double(target), 1.0)
    }

    var isCompleted: Bool {
        currentProgress >= target
    }

    var remainingDays: Int {
        let calendar = Calendar.current
        let endDate: Date

        switch period {
        case .daily:
            endDate = calendar.startOfDay(for: startDate.addingTimeInterval(86400))
        case .weekly:
            endDate = calendar.date(byAdding: .weekOfYear, value: 1, to: startDate) ?? startDate
        case .monthly:
            endDate = calendar.date(byAdding: .month, value: 1, to: startDate) ?? startDate
        case .yearly:
            endDate = calendar.date(byAdding: .year, value: 1, to: startDate) ?? startDate
        }

        let components = calendar.dateComponents([.day], from: .now, to: endDate)
        return max(0, components.day ?? 0)
    }

    init(type: GoalType, period: GoalPeriod, target: Int) {
        self.id = UUID()
        self.type = type
        self.period = period
        self.target = target
        self.currentProgress = 0
        self.startDate = .now
        self.isActive = true
        self.reminderEnabled = false
        self.reminderTime = nil
    }
}
```

### 2.3 Goal Service

```swift
import SwiftData
import Foundation
import UserNotifications

@Observable
class GoalService {
    private let modelContext: ModelContext
    private let notificationCenter = UNUserNotificationCenter.current()

    init(modelContext: ModelContext) {
        self.modelContext = modelContext
    }

    // MARK: - Goal Management

    func createGoal(type: GoalType, period: GoalPeriod, target: Int) -> ReadingGoal {
        let goal = ReadingGoal(type: type, period: period, target: target)
        modelContext.insert(goal)
        try? modelContext.save()
        return goal
    }

    func updateProgress(for goal: ReadingGoal, progress: Int) {
        goal.currentProgress = progress

        if goal.isCompleted {
            triggerCompletionCelebration(goal)
        }

        try? modelContext.save()
    }

    func resetGoalIfNeeded(_ goal: ReadingGoal) {
        let calendar = Calendar.current
        let shouldReset: Bool

        switch goal.period {
        case .daily:
            shouldReset = !calendar.isDateInToday(goal.startDate)
        case .weekly:
            shouldReset = !calendar.isDate(goal.startDate, equalTo: .now, toGranularity: .weekOfYear)
        case .monthly:
            shouldReset = !calendar.isDate(goal.startDate, equalTo: .now, toGranularity: .month)
        case .yearly:
            shouldReset = !calendar.isDate(goal.startDate, equalTo: .now, toGranularity: .year)
        }

        if shouldReset {
            goal.currentProgress = 0
            goal.startDate = calendar.startOfDay(for: .now)
            try? modelContext.save()
        }
    }

    // MARK: - Reminders

    func scheduleReminder(for goal: ReadingGoal, at time: Date) async {
        let settings = await notificationCenter.notificationSettings()
        guard settings.authorizationStatus == .authorized else {
            await requestNotificationPermission()
            return
        }

        goal.reminderEnabled = true
        goal.reminderTime = time

        let content = UNMutableNotificationContent()
        content.title = "Reading Goal Reminder"
        content.body = reminderMessage(for: goal)
        content.sound = .default
        content.categoryIdentifier = "READING_REMINDER"

        let calendar = Calendar.current
        let components = calendar.dateComponents([.hour, .minute], from: time)
        let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: true)

        let request = UNNotificationRequest(
            identifier: "goal-reminder-\(goal.id.uuidString)",
            content: content,
            trigger: trigger
        )

        try? await notificationCenter.add(request)
        try? modelContext.save()
    }

    func cancelReminder(for goal: ReadingGoal) {
        goal.reminderEnabled = false
        goal.reminderTime = nil
        notificationCenter.removePendingNotificationRequests(
            withIdentifiers: ["goal-reminder-\(goal.id.uuidString)"]
        )
        try? modelContext.save()
    }

    private func reminderMessage(for goal: ReadingGoal) -> String {
        let remaining = goal.target - goal.currentProgress
        let unit = goal.type.unit

        if goal.currentProgress == 0 {
            return "Time to start reading! Your goal: \(goal.target) \(unit) today."
        } else if goal.isCompleted {
            return "Great job! You've completed today's reading goal!"
        } else {
            return "You're \(goal.progressPercentage.formatted(.percent)) there! \(remaining) \(unit) to go."
        }
    }

    private func requestNotificationPermission() async {
        try? await notificationCenter.requestAuthorization(options: [.alert, .badge, .sound])
    }

    private func triggerCompletionCelebration(_ goal: ReadingGoal) {
        // Post notification for UI celebration
        NotificationCenter.default.post(
            name: .goalCompleted,
            object: nil,
            userInfo: ["goal": goal]
        )
    }
}

extension Notification.Name {
    static let goalCompleted = Notification.Name("goalCompleted")
}
```

### 2.4 Goal UI Components

```swift
import SwiftUI

struct GoalProgressView: View {
    let goal: ReadingGoal

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: goal.type.icon)
                    .foregroundStyle(.blue)

                Text("\(goal.period.rawValue) \(goal.type.rawValue) Goal")
                    .font(.headline)

                Spacer()

                if goal.isCompleted {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                }
            }

            ProgressView(value: goal.progressPercentage)
                .tint(goal.isCompleted ? .green : .blue)

            HStack {
                Text("\(goal.currentProgress) / \(goal.target) \(goal.type.unit)")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Spacer()

                Text("\(Int(goal.progressPercentage * 100))%")
                    .font(.caption)
                    .fontWeight(.medium)
            }
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(12)
    }
}

struct GoalSetupSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var selectedType: GoalType = .time
    @State private var selectedPeriod: GoalPeriod = .daily
    @State private var targetValue: Int = 30
    @State private var enableReminder = false
    @State private var reminderTime = Date()

    let onSave: (GoalType, GoalPeriod, Int, Bool, Date?) -> Void

    var body: some View {
        NavigationStack {
            Form {
                Section("Goal Type") {
                    Picker("What to track", selection: $selectedType) {
                        ForEach(GoalType.allCases, id: \.self) { type in
                            Label(type.rawValue, systemImage: type.icon)
                                .tag(type)
                        }
                    }
                    .pickerStyle(.menu)
                }

                Section("Period") {
                    Picker("How often", selection: $selectedPeriod) {
                        ForEach(GoalPeriod.allCases, id: \.self) { period in
                            Text(period.rawValue).tag(period)
                        }
                    }
                    .pickerStyle(.segmented)
                }

                Section("Target") {
                    Stepper(
                        "\(targetValue) \(selectedType.unit)",
                        value: $targetValue,
                        in: suggestedRange,
                        step: suggestedStep
                    )
                }

                Section("Reminder") {
                    Toggle("Daily reminder", isOn: $enableReminder)

                    if enableReminder {
                        DatePicker(
                            "Reminder time",
                            selection: $reminderTime,
                            displayedComponents: .hourAndMinute
                        )
                    }
                }
            }
            .navigationTitle("Set Reading Goal")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        onSave(
                            selectedType,
                            selectedPeriod,
                            targetValue,
                            enableReminder,
                            enableReminder ? reminderTime : nil
                        )
                        dismiss()
                    }
                }
            }
        }
    }

    private var suggestedRange: ClosedRange<Int> {
        switch selectedType {
        case .time: return 5...180
        case .pages: return 1...100
        case .books: return 1...52
        case .sessions: return 1...10
        }
    }

    private var suggestedStep: Int {
        switch selectedType {
        case .time: return 5
        case .pages: return 5
        case .books: return 1
        case .sessions: return 1
        }
    }
}
```

---

## 3. Streaks

### 3.1 Streak Mechanics

Streaks track consecutive days of reading activity, providing powerful motivation through loss aversion psychology.

**Key features:**
- Daily streak counter
- Streak freeze (protection against losing streak)
- Streak recovery (purchase/earn freezes)
- Milestone celebrations
- Calendar visualization

### 3.2 SwiftData Model

```swift
import SwiftData
import Foundation

@Model
class StreakData {
    var id: UUID
    var currentStreak: Int
    var longestStreak: Int
    var lastActiveDate: Date?
    var availableFreezes: Int
    var usedFreezes: Int
    var streakHistory: [Date] // Dates when user was active

    var isActiveToday: Bool {
        guard let lastActive = lastActiveDate else { return false }
        return Calendar.current.isDateInToday(lastActive)
    }

    var willLoseStreakTomorrow: Bool {
        guard let lastActive = lastActiveDate else { return false }
        return Calendar.current.isDateInYesterday(lastActive) && !isActiveToday
    }

    init() {
        self.id = UUID()
        self.currentStreak = 0
        self.longestStreak = 0
        self.lastActiveDate = nil
        self.availableFreezes = 2
        self.usedFreezes = 0
        self.streakHistory = []
    }
}
```

### 3.3 Streak Service

```swift
import SwiftData
import Foundation

@Observable
class StreakService {
    private let modelContext: ModelContext

    init(modelContext: ModelContext) {
        self.modelContext = modelContext
    }

    func recordActivity() {
        guard let streak = fetchStreak() else { return }

        let calendar = Calendar.current
        let today = calendar.startOfDay(for: .now)

        // Already recorded today
        if streak.isActiveToday {
            return
        }

        // Check if streak should continue, freeze, or reset
        if let lastActive = streak.lastActiveDate {
            let lastActiveDay = calendar.startOfDay(for: lastActive)
            let daysDifference = calendar.dateComponents([.day], from: lastActiveDay, to: today).day ?? 0

            switch daysDifference {
            case 1:
                // Consecutive day - extend streak
                streak.currentStreak += 1
            case 2:
                // Missed one day - use freeze if available
                if streak.availableFreezes > 0 {
                    streak.availableFreezes -= 1
                    streak.usedFreezes += 1
                    streak.currentStreak += 1
                    // Add yesterday as "frozen" day
                    if let yesterday = calendar.date(byAdding: .day, value: -1, to: today) {
                        streak.streakHistory.append(yesterday)
                    }
                } else {
                    // No freeze available - reset streak
                    streak.currentStreak = 1
                }
            default:
                // Missed more than one day - reset
                streak.currentStreak = 1
            }
        } else {
            // First activity
            streak.currentStreak = 1
        }

        streak.lastActiveDate = .now
        streak.streakHistory.append(today)

        // Update longest streak
        if streak.currentStreak > streak.longestStreak {
            streak.longestStreak = streak.currentStreak
        }

        try? modelContext.save()

        // Check for milestone
        checkMilestone(streak.currentStreak)
    }

    func useStreakFreeze() -> Bool {
        guard let streak = fetchStreak(),
              streak.availableFreezes > 0 else {
            return false
        }

        streak.availableFreezes -= 1
        streak.usedFreezes += 1
        try? modelContext.save()
        return true
    }

    func awardStreakFreeze(count: Int = 1) {
        guard let streak = fetchStreak() else { return }
        streak.availableFreezes += count
        try? modelContext.save()
    }

    private func fetchStreak() -> StreakData? {
        let descriptor = FetchDescriptor<StreakData>()
        return try? modelContext.fetch(descriptor).first
    }

    private func checkMilestone(_ days: Int) {
        let milestones = [7, 14, 30, 50, 100, 365]
        if milestones.contains(days) {
            NotificationCenter.default.post(
                name: .streakMilestone,
                object: nil,
                userInfo: ["days": days]
            )
        }
    }
}

extension Notification.Name {
    static let streakMilestone = Notification.Name("streakMilestone")
}
```

### 3.4 Streak UI Components

```swift
import SwiftUI

struct StreakView: View {
    let streak: StreakData

    var body: some View {
        VStack(spacing: 16) {
            // Main streak display
            ZStack {
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [.orange, .red],
                            center: .center,
                            startRadius: 0,
                            endRadius: 60
                        )
                    )
                    .frame(width: 120, height: 120)

                VStack(spacing: 4) {
                    Image(systemName: "flame.fill")
                        .font(.title)
                        .foregroundStyle(.white)

                    Text("\(streak.currentStreak)")
                        .font(.system(size: 36, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)

                    Text("day streak")
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.8))
                }
            }

            // Freeze availability
            HStack(spacing: 8) {
                ForEach(0..<3, id: \.self) { index in
                    Image(systemName: index < streak.availableFreezes ? "snowflake" : "snowflake")
                        .foregroundStyle(index < streak.availableFreezes ? .blue : .gray.opacity(0.3))
                }

                Text("\(streak.availableFreezes) freezes available")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            // Status message
            if streak.willLoseStreakTomorrow {
                Label("Read today to keep your streak!", systemImage: "exclamationmark.triangle")
                    .font(.callout)
                    .foregroundStyle(.orange)
            } else if streak.isActiveToday {
                Label("You're on fire today!", systemImage: "checkmark.circle.fill")
                    .font(.callout)
                    .foregroundStyle(.green)
            }
        }
        .padding()
    }
}

struct StreakCalendarView: View {
    let streakHistory: [Date]
    @State private var selectedMonth = Date()

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Month navigation
            HStack {
                Button(action: previousMonth) {
                    Image(systemName: "chevron.left")
                }

                Spacer()

                Text(selectedMonth, format: .dateTime.month(.wide).year())
                    .font(.headline)

                Spacer()

                Button(action: nextMonth) {
                    Image(systemName: "chevron.right")
                }
            }

            // Calendar grid
            LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 7), spacing: 8) {
                ForEach(["S", "M", "T", "W", "T", "F", "S"], id: \.self) { day in
                    Text(day)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }

                ForEach(daysInMonth(), id: \.self) { date in
                    if let date = date {
                        DayCell(
                            date: date,
                            isActive: isDateActive(date),
                            isToday: Calendar.current.isDateInToday(date)
                        )
                    } else {
                        Text("")
                    }
                }
            }
        }
        .padding()
    }

    private func daysInMonth() -> [Date?] {
        let calendar = Calendar.current
        let range = calendar.range(of: .day, in: .month, for: selectedMonth)!
        let firstDay = calendar.date(from: calendar.dateComponents([.year, .month], from: selectedMonth))!
        let firstWeekday = calendar.component(.weekday, from: firstDay)

        var days: [Date?] = Array(repeating: nil, count: firstWeekday - 1)

        for day in range {
            if let date = calendar.date(byAdding: .day, value: day - 1, to: firstDay) {
                days.append(date)
            }
        }

        return days
    }

    private func isDateActive(_ date: Date) -> Bool {
        let calendar = Calendar.current
        return streakHistory.contains { calendar.isDate($0, inSameDayAs: date) }
    }

    private func previousMonth() {
        selectedMonth = Calendar.current.date(byAdding: .month, value: -1, to: selectedMonth) ?? selectedMonth
    }

    private func nextMonth() {
        selectedMonth = Calendar.current.date(byAdding: .month, value: 1, to: selectedMonth) ?? selectedMonth
    }
}

struct DayCell: View {
    let date: Date
    let isActive: Bool
    let isToday: Bool

    var body: some View {
        ZStack {
            if isActive {
                Circle()
                    .fill(.orange)
                    .frame(width: 32, height: 32)
            }

            Text("\(Calendar.current.component(.day, from: date))")
                .font(.caption)
                .fontWeight(isToday ? .bold : .regular)
                .foregroundStyle(isActive ? .white : (isToday ? .primary : .secondary))
        }
        .frame(height: 36)
    }
}
```

---

## 4. Achievements

### 4.1 Achievement Types

| Category | Examples |
|----------|----------|
| **Milestones** | First book, 10 books, 100 books |
| **Streaks** | 7-day streak, 30-day streak, 365-day streak |
| **Time** | 1 hour total, 100 hours, reading marathon (2+ hours) |
| **Exploration** | First genre, 5 different genres |
| **Social** | First share, first review |
| **Special** | Night owl (read after midnight), Early bird, Weekend warrior |

### 4.2 SwiftData Models

```swift
import SwiftData
import Foundation

enum AchievementCategory: String, Codable, CaseIterable {
    case milestone = "Milestone"
    case streak = "Streak"
    case time = "Time"
    case exploration = "Exploration"
    case social = "Social"
    case special = "Special"
}

enum AchievementRarity: String, Codable {
    case common = "Common"
    case uncommon = "Uncommon"
    case rare = "Rare"
    case epic = "Epic"
    case legendary = "Legendary"

    var color: String {
        switch self {
        case .common: return "gray"
        case .uncommon: return "green"
        case .rare: return "blue"
        case .epic: return "purple"
        case .legendary: return "orange"
        }
    }
}

@Model
class Achievement {
    var id: String // Unique identifier like "first_book", "streak_7"
    var name: String
    var descriptionText: String
    var icon: String
    var category: AchievementCategory
    var rarity: AchievementRarity
    var isUnlocked: Bool
    var unlockedDate: Date?
    var progress: Int
    var target: Int
    var isSecret: Bool

    var progressPercentage: Double {
        guard target > 0 else { return 0 }
        return min(Double(progress) / Double(target), 1.0)
    }

    init(
        id: String,
        name: String,
        description: String,
        icon: String,
        category: AchievementCategory,
        rarity: AchievementRarity,
        target: Int = 1,
        isSecret: Bool = false
    ) {
        self.id = id
        self.name = name
        self.descriptionText = description
        self.icon = icon
        self.category = category
        self.rarity = rarity
        self.isUnlocked = false
        self.unlockedDate = nil
        self.progress = 0
        self.target = target
        self.isSecret = isSecret
    }
}

// Achievement definitions
struct AchievementDefinitions {
    static let all: [(id: String, name: String, description: String, icon: String, category: AchievementCategory, rarity: AchievementRarity, target: Int, isSecret: Bool)] = [
        // Milestones
        ("first_book", "First Chapter", "Complete your first book", "book.closed.fill", .milestone, .common, 1, false),
        ("books_10", "Bookworm", "Complete 10 books", "books.vertical.fill", .milestone, .uncommon, 10, false),
        ("books_50", "Library Builder", "Complete 50 books", "building.columns.fill", .milestone, .rare, 50, false),
        ("books_100", "Century Reader", "Complete 100 books", "star.fill", .milestone, .epic, 100, false),

        // Streaks
        ("streak_7", "Week Warrior", "Maintain a 7-day reading streak", "flame.fill", .streak, .common, 7, false),
        ("streak_30", "Monthly Master", "Maintain a 30-day reading streak", "flame.fill", .streak, .uncommon, 30, false),
        ("streak_100", "Centurion", "Maintain a 100-day reading streak", "flame.fill", .streak, .rare, 100, false),
        ("streak_365", "Year of Reading", "Maintain a 365-day reading streak", "flame.fill", .streak, .legendary, 365, false),

        // Time
        ("time_1h", "First Hour", "Read for a total of 1 hour", "clock.fill", .time, .common, 60, false),
        ("time_100h", "Dedicated Reader", "Read for a total of 100 hours", "clock.badge.checkmark.fill", .time, .rare, 6000, false),
        ("marathon", "Reading Marathon", "Read for 2+ hours in one session", "figure.run", .time, .uncommon, 1, false),

        // Special
        ("night_owl", "Night Owl", "Read after midnight", "moon.stars.fill", .special, .uncommon, 1, true),
        ("early_bird", "Early Bird", "Read before 6 AM", "sunrise.fill", .special, .uncommon, 1, true),
        ("weekend_warrior", "Weekend Warrior", "Read every day of a weekend", "calendar", .special, .common, 1, false),
    ]
}
```

### 4.3 Achievement Service

```swift
import SwiftData
import Foundation

@Observable
class AchievementService {
    private let modelContext: ModelContext

    init(modelContext: ModelContext) {
        self.modelContext = modelContext
    }

    func initializeAchievements() {
        let descriptor = FetchDescriptor<Achievement>()
        let existing = (try? modelContext.fetch(descriptor)) ?? []
        let existingIds = Set(existing.map { $0.id })

        for def in AchievementDefinitions.all where !existingIds.contains(def.id) {
            let achievement = Achievement(
                id: def.id,
                name: def.name,
                description: def.description,
                icon: def.icon,
                category: def.category,
                rarity: def.rarity,
                target: def.target,
                isSecret: def.isSecret
            )
            modelContext.insert(achievement)
        }

        try? modelContext.save()
    }

    func updateProgress(achievementId: String, progress: Int) {
        guard let achievement = fetchAchievement(id: achievementId) else { return }

        achievement.progress = progress

        if progress >= achievement.target && !achievement.isUnlocked {
            unlock(achievement)
        }

        try? modelContext.save()
    }

    func incrementProgress(achievementId: String, by amount: Int = 1) {
        guard let achievement = fetchAchievement(id: achievementId) else { return }
        updateProgress(achievementId: achievementId, progress: achievement.progress + amount)
    }

    func checkTimeBasedAchievements() {
        let hour = Calendar.current.component(.hour, from: .now)

        // Night owl: reading after midnight (0-4 AM)
        if hour >= 0 && hour < 4 {
            unlockIfNotUnlocked("night_owl")
        }

        // Early bird: reading before 6 AM
        if hour >= 4 && hour < 6 {
            unlockIfNotUnlocked("early_bird")
        }
    }

    private func unlock(_ achievement: Achievement) {
        achievement.isUnlocked = true
        achievement.unlockedDate = .now

        NotificationCenter.default.post(
            name: .achievementUnlocked,
            object: nil,
            userInfo: ["achievement": achievement]
        )
    }

    private func unlockIfNotUnlocked(_ id: String) {
        guard let achievement = fetchAchievement(id: id),
              !achievement.isUnlocked else { return }

        achievement.progress = achievement.target
        unlock(achievement)
        try? modelContext.save()
    }

    private func fetchAchievement(id: String) -> Achievement? {
        let descriptor = FetchDescriptor<Achievement>(
            predicate: #Predicate { $0.id == id }
        )
        return try? modelContext.fetch(descriptor).first
    }

    func getUnlockedAchievements() -> [Achievement] {
        let descriptor = FetchDescriptor<Achievement>(
            predicate: #Predicate { $0.isUnlocked },
            sortBy: [SortDescriptor(\.unlockedDate, order: .reverse)]
        )
        return (try? modelContext.fetch(descriptor)) ?? []
    }

    func getAchievementsByCategory(_ category: AchievementCategory) -> [Achievement] {
        let categoryRaw = category.rawValue
        let descriptor = FetchDescriptor<Achievement>(
            predicate: #Predicate { $0.category.rawValue == categoryRaw }
        )
        return (try? modelContext.fetch(descriptor)) ?? []
    }
}

extension Notification.Name {
    static let achievementUnlocked = Notification.Name("achievementUnlocked")
}
```

### 4.4 Achievement UI Components

```swift
import SwiftUI

struct AchievementBadge: View {
    let achievement: Achievement
    let size: CGFloat

    init(achievement: Achievement, size: CGFloat = 60) {
        self.achievement = achievement
        self.size = size
    }

    var body: some View {
        ZStack {
            // Background
            Circle()
                .fill(achievement.isUnlocked ? rarityGradient : lockedGradient)
                .frame(width: size, height: size)

            // Icon
            Image(systemName: achievement.icon)
                .font(.system(size: size * 0.4))
                .foregroundStyle(achievement.isUnlocked ? .white : .gray)

            // Lock overlay
            if !achievement.isUnlocked && !achievement.isSecret {
                Circle()
                    .fill(.black.opacity(0.5))
                    .frame(width: size, height: size)

                Image(systemName: "lock.fill")
                    .foregroundStyle(.white)
            }

            // Secret badge
            if achievement.isSecret && !achievement.isUnlocked {
                Circle()
                    .fill(.black.opacity(0.7))
                    .frame(width: size, height: size)

                Image(systemName: "questionmark")
                    .foregroundStyle(.white)
            }
        }
    }

    private var rarityGradient: LinearGradient {
        let colors: [Color]
        switch achievement.rarity {
        case .common:
            colors = [.gray, .gray.opacity(0.7)]
        case .uncommon:
            colors = [.green, .green.opacity(0.7)]
        case .rare:
            colors = [.blue, .cyan]
        case .epic:
            colors = [.purple, .pink]
        case .legendary:
            colors = [.orange, .yellow]
        }
        return LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing)
    }

    private var lockedGradient: LinearGradient {
        LinearGradient(colors: [.gray.opacity(0.3), .gray.opacity(0.2)], startPoint: .topLeading, endPoint: .bottomTrailing)
    }
}

struct AchievementCard: View {
    let achievement: Achievement

    var body: some View {
        HStack(spacing: 16) {
            AchievementBadge(achievement: achievement, size: 50)

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(achievement.isSecret && !achievement.isUnlocked ? "???" : achievement.name)
                        .font(.headline)

                    Text(achievement.rarity.rawValue)
                        .font(.caption2)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color(achievement.rarity.color).opacity(0.2))
                        .foregroundStyle(Color(achievement.rarity.color))
                        .cornerRadius(4)
                }

                Text(achievement.isSecret && !achievement.isUnlocked ? "Complete a secret challenge" : achievement.descriptionText)
                    .font(.caption)
                    .foregroundStyle(.secondary)

                if !achievement.isUnlocked && achievement.target > 1 {
                    ProgressView(value: achievement.progressPercentage)
                        .tint(Color(achievement.rarity.color))

                    Text("\(achievement.progress) / \(achievement.target)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }

                if let date = achievement.unlockedDate {
                    Text("Unlocked \(date, format: .dateTime.month().day().year())")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(12)
    }
}

struct AchievementUnlockOverlay: View {
    let achievement: Achievement
    @State private var showAnimation = false
    @State private var showContent = false

    var body: some View {
        ZStack {
            Color.black.opacity(0.7)
                .ignoresSafeArea()
                .opacity(showAnimation ? 1 : 0)

            VStack(spacing: 24) {
                Text("Achievement Unlocked!")
                    .font(.title2)
                    .fontWeight(.bold)
                    .foregroundStyle(.white)

                AchievementBadge(achievement: achievement, size: 120)
                    .scaleEffect(showContent ? 1 : 0.5)
                    .opacity(showContent ? 1 : 0)

                VStack(spacing: 8) {
                    Text(achievement.name)
                        .font(.title3)
                        .fontWeight(.semibold)
                        .foregroundStyle(.white)

                    Text(achievement.descriptionText)
                        .font(.body)
                        .foregroundStyle(.white.opacity(0.8))
                        .multilineTextAlignment(.center)
                }
                .opacity(showContent ? 1 : 0)
            }
            .padding(40)
        }
        .onAppear {
            withAnimation(.easeOut(duration: 0.3)) {
                showAnimation = true
            }
            withAnimation(.spring(response: 0.5, dampingFraction: 0.6).delay(0.2)) {
                showContent = true
            }
        }
    }
}

struct AchievementsListView: View {
    @Query private var achievements: [Achievement]
    @State private var selectedCategory: AchievementCategory?

    var filteredAchievements: [Achievement] {
        if let category = selectedCategory {
            return achievements.filter { $0.category == category }
        }
        return achievements
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Category filter
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        CategoryChip(
                            title: "All",
                            isSelected: selectedCategory == nil,
                            action: { selectedCategory = nil }
                        )

                        ForEach(AchievementCategory.allCases, id: \.self) { category in
                            CategoryChip(
                                title: category.rawValue,
                                isSelected: selectedCategory == category,
                                action: { selectedCategory = category }
                            )
                        }
                    }
                    .padding()
                }

                // Progress summary
                let unlocked = achievements.filter { $0.isUnlocked }.count
                let total = achievements.count

                HStack {
                    Text("\(unlocked) / \(total) Achievements")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)

                    Spacer()

                    ProgressView(value: Double(unlocked) / Double(max(total, 1)))
                        .frame(width: 100)
                }
                .padding(.horizontal)

                // Achievements list
                ScrollView {
                    LazyVStack(spacing: 12) {
                        ForEach(filteredAchievements.sorted {
                            ($0.isUnlocked ? 0 : 1, $0.rarity.rawValue) < ($1.isUnlocked ? 0 : 1, $1.rarity.rawValue)
                        }, id: \.id) { achievement in
                            AchievementCard(achievement: achievement)
                        }
                    }
                    .padding()
                }
            }
            .navigationTitle("Achievements")
        }
    }
}

struct CategoryChip: View {
    let title: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(isSelected ? Color.accentColor : Color(.systemGray5))
                .foregroundStyle(isSelected ? .white : .primary)
                .cornerRadius(20)
        }
    }
}
```

### 4.5 Game Center Integration (Optional)

```swift
import GameKit
import SwiftUI

class GameCenterManager: NSObject, ObservableObject {
    static let shared = GameCenterManager()

    @Published var isAuthenticated = false
    @Published var localPlayer: GKLocalPlayer?

    override init() {
        super.init()
    }

    func authenticate() {
        GKLocalPlayer.local.authenticateHandler = { [weak self] viewController, error in
            if let vc = viewController {
                // Present authentication view controller
                NotificationCenter.default.post(
                    name: .presentGameCenterAuth,
                    object: vc
                )
                return
            }

            if let error = error {
                print("Game Center auth error: \(error.localizedDescription)")
                return
            }

            DispatchQueue.main.async {
                self?.isAuthenticated = GKLocalPlayer.local.isAuthenticated
                self?.localPlayer = GKLocalPlayer.local
            }
        }
    }

    func reportAchievement(identifier: String, percentComplete: Double) {
        guard isAuthenticated else { return }

        let achievement = GKAchievement(identifier: identifier)
        achievement.percentComplete = percentComplete
        achievement.showsCompletionBanner = true

        GKAchievement.report([achievement]) { error in
            if let error = error {
                print("Failed to report achievement: \(error.localizedDescription)")
            }
        }
    }

    func showAchievements() {
        guard isAuthenticated else { return }

        let vc = GKGameCenterViewController(state: .achievements)
        vc.gameCenterDelegate = self

        NotificationCenter.default.post(
            name: .presentGameCenterVC,
            object: vc
        )
    }
}

extension GameCenterManager: GKGameCenterControllerDelegate {
    func gameCenterViewControllerDidFinish(_ gameCenterViewController: GKGameCenterViewController) {
        gameCenterViewController.dismiss(animated: true)
    }
}

extension Notification.Name {
    static let presentGameCenterAuth = Notification.Name("presentGameCenterAuth")
    static let presentGameCenterVC = Notification.Name("presentGameCenterVC")
}

// SwiftUI wrapper for Game Center view controller
struct GameCenterView: UIViewControllerRepresentable {
    let viewController: GKGameCenterViewController

    func makeUIViewController(context: Context) -> GKGameCenterViewController {
        viewController.gameCenterDelegate = context.coordinator
        return viewController
    }

    func updateUIViewController(_ uiViewController: GKGameCenterViewController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    class Coordinator: NSObject, GKGameCenterControllerDelegate {
        func gameCenterViewControllerDidFinish(_ gameCenterViewController: GKGameCenterViewController) {
            gameCenterViewController.dismiss(animated: true)
        }
    }
}
```

---

## 5. Leaderboards

### 5.1 Privacy Considerations

| Approach | Pros | Cons |
|----------|------|------|
| **Fully Anonymous** | Maximum privacy, no social pressure | Less engaging, no identity |
| **Pseudonymous** | Balance of privacy and identity | Usernames can still identify |
| **Friends Only** | Safe social comparison | Requires social features |
| **Opt-in Public** | User choice, transparent | Complexity, default matters |

**Recommendation:** Default to pseudonymous/friends-only with opt-in for public leaderboards.

### 5.2 Leaderboard Categories

- **Weekly Reading Time** - Resets each week, gives everyone a fresh start
- **Monthly Books Completed** - Monthly reset
- **All-Time Pages Read** - Persistent, rewards long-term users
- **Current Streak** - Dynamic, changes daily

### 5.3 SwiftData Models

```swift
import SwiftData
import Foundation

enum LeaderboardType: String, Codable, CaseIterable {
    case weeklyTime = "Weekly Reading Time"
    case monthlyBooks = "Monthly Books"
    case allTimePages = "All-Time Pages"
    case currentStreak = "Current Streak"
}

enum LeaderboardVisibility: String, Codable {
    case anonymous
    case pseudonymous
    case friendsOnly
    case publicVisible
}

@Model
class LeaderboardEntry {
    var id: UUID
    var userId: UUID
    var displayName: String
    var leaderboardType: LeaderboardType
    var score: Int
    var rank: Int?
    var periodStart: Date
    var updatedAt: Date

    init(userId: UUID, displayName: String, type: LeaderboardType, score: Int) {
        self.id = UUID()
        self.userId = userId
        self.displayName = displayName
        self.leaderboardType = type
        self.score = score
        self.rank = nil
        self.periodStart = .now
        self.updatedAt = .now
    }
}

@Model
class UserLeaderboardSettings {
    var id: UUID
    var userId: UUID
    var visibility: LeaderboardVisibility
    var displayName: String
    var participateInLeaderboards: Bool

    init(userId: UUID) {
        self.id = UUID()
        self.userId = userId
        self.visibility = .pseudonymous
        self.displayName = "Reader\(Int.random(in: 1000...9999))"
        self.participateInLeaderboards = true
    }
}
```

### 5.4 Leaderboard UI

```swift
import SwiftUI

struct LeaderboardView: View {
    @State private var selectedType: LeaderboardType = .weeklyTime
    @State private var entries: [LeaderboardEntry] = []
    @State private var userRank: Int?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Type picker
                Picker("Leaderboard", selection: $selectedType) {
                    ForEach(LeaderboardType.allCases, id: \.self) { type in
                        Text(type.rawValue).tag(type)
                    }
                }
                .pickerStyle(.segmented)
                .padding()

                // User's rank card
                if let rank = userRank {
                    UserRankCard(rank: rank, type: selectedType)
                        .padding(.horizontal)
                }

                // Leaderboard list
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                            LeaderboardRow(
                                rank: index + 1,
                                entry: entry,
                                isCurrentUser: entry.userId == getCurrentUserId()
                            )
                        }
                    }
                    .padding()
                }
            }
            .navigationTitle("Leaderboard")
        }
    }

    private func getCurrentUserId() -> UUID {
        // Return current user's ID
        UUID()
    }
}

struct UserRankCard: View {
    let rank: Int
    let type: LeaderboardType

    var body: some View {
        HStack {
            VStack(alignment: .leading) {
                Text("Your Rank")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Text("#\(rank)")
                    .font(.title)
                    .fontWeight(.bold)
            }

            Spacer()

            Image(systemName: rankIcon)
                .font(.title)
                .foregroundStyle(rankColor)
        }
        .padding()
        .background(rankColor.opacity(0.1))
        .cornerRadius(12)
    }

    private var rankIcon: String {
        switch rank {
        case 1: return "trophy.fill"
        case 2, 3: return "medal.fill"
        default: return "star.fill"
        }
    }

    private var rankColor: Color {
        switch rank {
        case 1: return .yellow
        case 2: return .gray
        case 3: return .orange
        default: return .blue
        }
    }
}

struct LeaderboardRow: View {
    let rank: Int
    let entry: LeaderboardEntry
    let isCurrentUser: Bool

    var body: some View {
        HStack(spacing: 16) {
            // Rank
            ZStack {
                if rank <= 3 {
                    Circle()
                        .fill(rankColor)
                        .frame(width: 32, height: 32)
                }

                Text("\(rank)")
                    .font(.headline)
                    .foregroundStyle(rank <= 3 ? .white : .primary)
            }
            .frame(width: 40)

            // User info
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.displayName)
                    .font(.body)
                    .fontWeight(isCurrentUser ? .bold : .regular)

                if isCurrentUser {
                    Text("You")
                        .font(.caption2)
                        .foregroundStyle(.blue)
                }
            }

            Spacer()

            // Score
            Text(formatScore(entry.score))
                .font(.headline)
                .foregroundStyle(.secondary)
        }
        .padding()
        .background(isCurrentUser ? Color.blue.opacity(0.1) : Color(.systemGray6))
        .cornerRadius(12)
    }

    private var rankColor: Color {
        switch rank {
        case 1: return .yellow
        case 2: return .gray
        case 3: return .orange
        default: return .clear
        }
    }

    private func formatScore(_ score: Int) -> String {
        switch entry.leaderboardType {
        case .weeklyTime:
            let hours = score / 60
            let minutes = score % 60
            return "\(hours)h \(minutes)m"
        case .monthlyBooks:
            return "\(score) books"
        case .allTimePages:
            if score >= 1000 {
                return String(format: "%.1fK", Double(score) / 1000)
            }
            return "\(score)"
        case .currentStreak:
            return "\(score) days"
        }
    }
}
```

### 5.5 Game Center Leaderboards

```swift
import GameKit

extension GameCenterManager {
    func submitScore(_ score: Int, to leaderboardID: String) {
        guard isAuthenticated else { return }

        GKLeaderboard.submitScore(
            score,
            context: 0,
            player: GKLocalPlayer.local,
            leaderboardIDs: [leaderboardID]
        ) { error in
            if let error = error {
                print("Failed to submit score: \(error.localizedDescription)")
            }
        }
    }

    func showLeaderboards() {
        guard isAuthenticated else { return }

        let vc = GKGameCenterViewController(state: .leaderboards)
        vc.gameCenterDelegate = self

        NotificationCenter.default.post(
            name: .presentGameCenterVC,
            object: vc
        )
    }

    func loadLeaderboardScores(
        leaderboardID: String,
        scope: GKLeaderboard.PlayerScope = .global,
        timeScope: GKLeaderboard.TimeScope = .week
    ) async -> [GKLeaderboard.Entry]? {
        guard isAuthenticated else { return nil }

        do {
            let leaderboards = try await GKLeaderboard.loadLeaderboards(IDs: [leaderboardID])
            guard let leaderboard = leaderboards.first else { return nil }

            let (_, entries, _) = try await leaderboard.loadEntries(
                for: scope,
                timeScope: timeScope,
                range: NSRange(location: 1, length: 100)
            )

            return entries
        } catch {
            print("Failed to load leaderboard: \(error.localizedDescription)")
            return nil
        }
    }
}
```

---

## 6. Competitor Analysis

### 6.1 Amazon Kindle Reading Insights

**Features:**
- Reading streaks (daily and weekly)
- Yearly reading challenge (customizable goal)
- Books finished this year counter
- Minutes read per day tracking
- Reading badges and achievements
- Goodreads integration (starting 2025)

**Strengths:**
- Seamless integration with Kindle ecosystem
- Automatic tracking (no manual input)
- Simple, non-intrusive UI

**Weaknesses:**
- Limited customization of goals
- No social features beyond Goodreads
- Basic statistics only

**Source:** [Kindle Reading Insights](https://www.amazon.com/kindle/reading/insights), [My Book Joy](https://mybookjoy.com/2022/04/07/kindle-has-achievements-now/)

### 6.2 Bookly

**Features:**
- Real-time reading timer with progress tracking
- Daily/monthly/yearly goals
- Reading speed calculation and time-to-finish estimates
- Diamonds (in-app currency) for customization
- Mascot costumes and app icon unlocks
- Ambient sounds during reading
- Quote and thought tracking
- Readathon challenges

**Strengths:**
- Highly gamified experience
- Detailed statistics and visualizations
- Engaging mascot system
- Social challenges

**Weaknesses:**
- Requires active timer usage
- Freemium model with paywalls
- Can feel overwhelming

**Source:** [Bookly Official](https://getbookly.com/), [Book Riot Review](https://bookriot.com/bookly-review/)

### 6.3 Goodreads

**Features:**
- Annual Reading Challenge
- Community groups for accountability
- Book ratings and reviews
- Reading timeline
- Mini-achievements (Heart Warmers, Spine Tinglers)
- Social comparison with friends

**Strengths:**
- Large community (90+ million members)
- Book discovery through reviews
- Simple yearly goal system
- Social accountability

**Weaknesses:**
- Limited gamification
- No reading time tracking
- Dated interface
- Owned by Amazon (privacy concerns)

**Source:** [Goodreads Reading Challenge](https://www.goodreads.com/group/show/58421-2025-reading-challenge)

### 6.4 The StoryGraph

**Features:**
- Daily reading streaks (opt-in)
- Detailed statistics (mood, pace, genre breakdowns)
- AI-powered recommendations
- Custom challenges
- Half/quarter star ratings
- Comparison stats (premium)
- No ads, independent

**Strengths:**
- Privacy-focused (not Amazon-owned)
- Detailed analytics and graphs
- Flexible goal systems
- Modern, clean interface

**Weaknesses:**
- Smaller community
- Premium features require subscription ($5/month)
- Limited social features

**Source:** [The StoryGraph](https://thestorygraph.com/), [Features Roadmap](https://roadmap.thestorygraph.com/features)

### 6.5 Competitive Analysis Summary

| Feature | Kindle | Bookly | Goodreads | StoryGraph | fancai (Proposed) |
|---------|--------|--------|-----------|------------|-------------------|
| Reading time tracking | Auto | Manual timer | No | Manual | Auto (page turns) |
| Daily streaks | Yes | Yes | No | Yes (opt-in) | Yes (opt-in) |
| Achievements | Basic | Extensive | Limited | No | Comprehensive |
| In-app rewards | No | Diamonds | No | No | Unlockables |
| Social features | Goodreads | Challenges | Strong | Basic | Friends |
| AI integration | No | Recommendations | No | Yes | Image generation |
| Statistics depth | Basic | Detailed | Basic | Detailed | Detailed |
| Privacy-first | No | Yes | No | Yes | Yes |

---

## 7. Psychology of Gamification

### 7.1 Intrinsic vs Extrinsic Motivation

**Intrinsic Motivation:** Doing something for its inherent enjoyment or interest.
- Reading for pleasure, curiosity, personal growth
- More sustainable long-term
- Leads to deeper engagement

**Extrinsic Motivation:** Doing something for external rewards or outcomes.
- Points, badges, leaderboards
- Effective for short-term behavior change
- Can undermine intrinsic motivation if overused

**Research findings:**
- Gamification enhances perceptions of autonomy (Hedges' g = 0.638) and relatedness (Hedges' g = 1.776), but has minimal impact on competence
- Tangible rewards can significantly undermine intrinsic motivation
- The novelty effect of gamification may wear off over time

**Source:** [PMC Research](https://pmc.ncbi.nlm.nih.gov/articles/PMC10448467/), [Springer Nature](https://link.springer.com/article/10.1007/s11423-023-10337-7)

### 7.2 Self-Determination Theory (SDT)

According to SDT, intrinsic motivation is supported by three basic psychological needs:

1. **Autonomy** - Control over one's decisions
   - Let users set their own goals
   - Provide opt-out options for gamification
   - Allow customization of experience

2. **Competence** - Feeling capable and effective
   - Gradual difficulty progression
   - Celebrate small wins
   - Provide meaningful feedback

3. **Relatedness** - Connection to others
   - Reading communities
   - Friend comparisons
   - Shared challenges

### 7.3 Reward Schedules

| Schedule | Description | Effect | Use Case |
|----------|-------------|--------|----------|
| Fixed Ratio | Reward after X actions | Predictable, steady effort | "Read 5 books for badge" |
| Variable Ratio | Reward after random number of actions | Highest engagement, addictive | Avoid or use carefully |
| Fixed Interval | Reward after X time | Regular check-ins | Daily login rewards |
| Variable Interval | Reward at random times | Unpredictable anticipation | Surprise bonuses |

**Variable ratio schedules** (like slot machines) create the highest engagement but are also the most addictive. They should be used sparingly and ethically.

**Source:** [Skinner Box Mechanics](https://medium.com/@milijanakomad/product-design-and-psychology-the-mechanism-of-skinner-box-techniques-in-video-game-design-5b7315e2d7b4), [Psychology Today](https://www.psychologytoday.com/us/blog/brain-wise/201311/use-unpredictable-rewards-to-keep-behavior-going)

### 7.4 Avoiding Dark Patterns

**Dark patterns in gamification:**
- Fear of Missing Out (FOMO) - Limited-time offers
- Loss aversion exploitation - Streak loss anxiety
- Social pressure - Public shaming on leaderboards
- Artificial scarcity - Premium-only features
- Grinding requirements - Tedious repetition

**Ethical design principles:**

1. **Transparency**
   - Clearly explain how gamification works
   - Show the mechanics, not just the rewards

2. **User Control**
   - Allow opting out of any feature
   - Provide gamification-free mode

3. **Positive Reinforcement**
   - Reward desired behaviors
   - Never punish disengagement

4. **Natural Stopping Points**
   - Design for healthy engagement
   - Include "take a break" suggestions

5. **Avoid Exploitative Mechanics**
   - No variable ratio rewards that mimic gambling
   - No artificial urgency
   - No pay-to-progress mechanics

**Source:** [Medium - Dark Side of Gamification](https://medium.com/@jgruver/the-dark-side-of-gamification-ethical-challenges-in-ux-ui-design-576965010dba), [DarkPattern.games](https://www.darkpattern.games)

### 7.5 Recommended Approach for fancai

```swift
// Example: Ethical gamification configuration
struct GamificationConfig {
    // Defaults to opt-in for potentially addictive features
    var streaksEnabled: Bool = false
    var leaderboardsEnabled: Bool = false
    var achievementsEnabled: Bool = true // Non-competitive
    var statisticsEnabled: Bool = true // Informational

    // User autonomy
    var canSetOwnGoals: Bool = true
    var canDisableNotifications: Bool = true
    var canHideFromLeaderboards: Bool = true

    // Healthy engagement
    var showBreakReminders: Bool = true
    var breakReminderMinutes: Int = 60
    var dailyReadingCapSuggestion: Int? = 180 // Optional cap

    // Transparency
    var showMechanicsExplanation: Bool = true
}
```

---

## 8. Implementation Recommendations

### 8.1 Phased Rollout

**Phase 1: Foundation (Week 1-2)**
- Reading statistics tracking
- Basic daily/weekly/monthly stats
- Charts visualization

**Phase 2: Goals (Week 3-4)**
- Goal setting UI
- Progress tracking
- Reminder notifications

**Phase 3: Engagement (Week 5-6)**
- Streaks (opt-in)
- Basic achievements
- Achievement unlock animations

**Phase 4: Social (Week 7-8)**
- Leaderboards (opt-in)
- Friend comparisons
- Game Center integration

### 8.2 Key Design Principles

1. **Privacy by Default**
   - All social features opt-in
   - Anonymous by default on leaderboards
   - Local-first data storage

2. **User Autonomy**
   - Customizable goals
   - Disable any feature
   - No FOMO mechanics

3. **Celebrate Reading, Not Metrics**
   - Focus on books completed, not just numbers
   - Highlight reading journey
   - Qualitative achievements (genres explored, etc.)

4. **Healthy Engagement**
   - Break reminders
   - No punishment for breaks
   - Streak freezes by default

### 8.3 Technical Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     fancai iOS App                          │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │   SwiftUI   │  │   Charts    │  │  Game Kit   │         │
│  │    Views    │  │   Views     │  │  (Optional) │         │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘         │
│         │                │                │                 │
│         ▼                ▼                ▼                 │
│  ┌─────────────────────────────────────────────────┐       │
│  │              Service Layer (@Observable)         │       │
│  │  ┌───────────┐ ┌───────────┐ ┌───────────┐     │       │
│  │  │ Reading   │ │  Goal     │ │Achievement│     │       │
│  │  │ Stats     │ │  Service  │ │  Service  │     │       │
│  │  │ Service   │ │           │ │           │     │       │
│  │  └───────────┘ └───────────┘ └───────────┘     │       │
│  │  ┌───────────┐ ┌───────────┐                   │       │
│  │  │  Streak   │ │Leaderboard│                   │       │
│  │  │  Service  │ │  Service  │                   │       │
│  │  └───────────┘ └───────────┘                   │       │
│  └──────────────────────┬──────────────────────────┘       │
│                         │                                   │
│                         ▼                                   │
│  ┌─────────────────────────────────────────────────┐       │
│  │              SwiftData Layer                     │       │
│  │  ┌───────────┐ ┌───────────┐ ┌───────────┐     │       │
│  │  │ Reading   │ │   Goals   │ │Achievements│    │       │
│  │  │ Sessions  │ │           │ │            │    │       │
│  │  └───────────┘ └───────────┘ └───────────┘     │       │
│  │  ┌───────────┐ ┌───────────┐ ┌───────────┐     │       │
│  │  │  Daily    │ │  Streak   │ │Leaderboard│     │       │
│  │  │  Stats    │ │   Data    │ │  Entries  │     │       │
│  │  └───────────┘ └───────────┘ └───────────┘     │       │
│  └─────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

### 8.4 Metrics to Monitor

| Metric | Good Sign | Concern |
|--------|-----------|---------|
| Daily Active Users | Steady/growing | Sudden drops |
| Session Duration | 15-60 min average | >2 hours average |
| Goal Completion Rate | 60-80% | <30% or >95% |
| Streak Length Distribution | Bell curve | All short or all long |
| Feature Opt-out Rate | <20% | >50% |
| User Feedback | Positive about reading | Focused on rewards |

---

## 9. Sources

### Apple Developer Documentation
- [SwiftData Documentation](https://developer.apple.com/documentation/swiftdata)
- [Swift Charts Documentation](https://developer.apple.com/documentation/charts/creating-a-chart-using-swift-charts)
- [WWDC 2022 - Hello Swift Charts](https://developer.apple.com/videos/play/wwdc2022/10136/)
- [WWDC 2020 - Tap into Game Center](https://developer.apple.com/videos/play/wwdc2020/10619/)

### Tutorials and Guides
- [Hacking with Swift - Local Notifications](https://www.hackingwithswift.com/books/ios-swiftui/scheduling-local-notifications)
- [FreeCodeCamp - GameKit Leaderboard in SwiftUI](https://www.freecodecamp.org/news/how-to-implement-a-leaderboard-in-swiftui/)
- [Bomberbot - GameKit Leaderboards in SwiftUI](https://www.bomberbot.com/swiftui/harnessing-the-power-of-gamekit-leaderboards-in-swiftui/)
- [tanaschita - iOS Local Notifications Guide](https://tanaschita.com/ios-local-notifications-guide/)

### Competitor Analysis
- [Amazon Kindle Reading Insights](https://www.amazon.com/kindle/reading/insights)
- [Bookly Official Website](https://getbookly.com/)
- [The StoryGraph](https://thestorygraph.com/)
- [Goodreads Reading Challenge](https://www.goodreads.com/group/show/58421-2025-reading-challenge)
- [My Book Joy - Kindle Achievements](https://mybookjoy.com/2022/04/07/kindle-has-achievements-now/)
- [Book Riot - Bookly Review](https://bookriot.com/bookly-review/)

### Research Papers and Psychology
- [PMC - Gamified Learning Strategies](https://pmc.ncbi.nlm.nih.gov/articles/PMC10448467/)
- [Springer - Gamification and Intrinsic Motivation](https://link.springer.com/article/10.1007/s11423-023-10337-7)
- [Beanstack - Reading Motivation Psychology](https://www.beanstack.com/blog/what-psychology-can-teach-us-about-supporting-students-intrinsic-motivation-to-read)
- [Psychology Today - Variable Rewards](https://www.psychologytoday.com/us/blog/brain-wise/201311/use-unpredictable-rewards-to-keep-behavior-going)

### Ethics and Dark Patterns
- [Medium - Dark Side of Gamification](https://medium.com/@jgruver/the-dark-side-of-gamification-ethical-challenges-in-ux-ui-design-576965010dba)
- [DarkPattern.games](https://www.darkpattern.games)
- [ACM - Designing Healthy Mobile Games](https://dl.acm.org/doi/fullHtml/10.1145/3491101.3519837)

---

**Report completed:** 2026-01-17
**Total sections:** 9
**Code examples:** 15+
**Estimated implementation time:** 8 weeks
