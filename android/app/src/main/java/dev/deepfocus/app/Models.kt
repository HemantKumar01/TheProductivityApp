package dev.deepfocus.app

import com.google.firebase.Timestamp
import java.time.LocalDate
import java.time.ZoneId

data class FocusSession(
    val id: String,
    val startsAtMillis: Long,
    val endsAtMillis: Long,
    val source: String,
)

data class BlockingSettings(
    val androidPackages: List<String> = emptyList(),
    val websiteDomains: List<String> = emptyList(),
    val allowedWebsiteDomains: List<String> = emptyList(),
)

data class FocusSchedule(
    val id: String,
    val enabled: Boolean = true,
    val weekdays: List<Int> = emptyList(),
    val localTime: String = "09:00",
    val timeZone: String = ZoneId.systemDefault().id,
    val durationMinutes: Int = 60,
)

data class FocusMetrics(
    val todayMillis: Long = 0,
    val continuousMillis: Long = 0,
    val longestMillis: Long = 0,
    val completedCount: Int = 0,
)

fun sessionFrom(id: String, data: Map<String, Any>): FocusSession? {
    val startsAt = data["startsAt"] as? Timestamp ?: return null
    val endsAt = data["endsAt"] as? Timestamp ?: return null
    return FocusSession(id, startsAt.toDate().time, endsAt.toDate().time, data["source"] as? String ?: "unknown")
}

fun calculateMetrics(sessions: List<FocusSession>, now: Long): FocusMetrics {
    val intervals = sessions.sortedBy { it.startsAtMillis }.fold(mutableListOf<Pair<Long, Long>>()) { merged, session ->
        val previous = merged.lastOrNull()
        if (previous == null || session.startsAtMillis > previous.second) {
            merged.add(session.startsAtMillis to session.endsAtMillis)
        } else {
            merged[merged.lastIndex] = previous.first to maxOf(previous.second, session.endsAtMillis)
        }
        merged
    }
    val zone = ZoneId.systemDefault()
    val dayStart = LocalDate.now(zone).atStartOfDay(zone).toInstant().toEpochMilli()
    val dayEnd = LocalDate.now(zone).plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()
    val today = intervals.sumOf { (start, end) -> maxOf(0, minOf(end, minOf(now, dayEnd)) - maxOf(start, dayStart)) }
    val active = intervals.firstOrNull { (start, end) -> start <= now && end > now }
    return FocusMetrics(
        todayMillis = today,
        continuousMillis = active?.let { now - it.first } ?: 0,
        longestMillis = intervals.maxOfOrNull { it.second - it.first } ?: 0,
        completedCount = sessions.count { it.endsAtMillis <= now },
    )
}
