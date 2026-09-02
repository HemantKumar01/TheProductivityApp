package dev.deepfocus.app

import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.SetOptions
import com.google.firebase.functions.FirebaseFunctions
import kotlinx.coroutines.tasks.await
import java.time.ZoneId

class FocusRepository(
    private val auth: FirebaseAuth = FirebaseAuth.getInstance(),
    private val db: FirebaseFirestore = FirebaseFirestore.getInstance(),
    private val functions: FirebaseFunctions = FirebaseFunctions.getInstance("asia-south1"),
) {
    fun observe(
        onSessions: (List<FocusSession>) -> Unit,
        onSettings: (BlockingSettings) -> Unit,
        onSchedules: (List<FocusSchedule>) -> Unit,
        onError: (String) -> Unit,
    ): List<ListenerRegistration> {
        val uid = auth.currentUser?.uid ?: return emptyList()
        val sessions = db.collection("users/$uid/sessions")
            .orderBy("startsAt", Query.Direction.DESCENDING).limit(300)
            .addSnapshotListener { snapshot, error ->
                if (error != null) onError(error.localizedMessage ?: "Session sync failed")
                else onSessions(snapshot?.documents?.mapNotNull { sessionFrom(it.id, it.data ?: emptyMap()) } ?: emptyList())
            }
        val settings = db.document("users/$uid/settings/blocking").addSnapshotListener { snapshot, error ->
            if (error != null) onError(error.localizedMessage ?: "Blocklist sync failed")
            else onSettings(BlockingSettings(
                androidPackages = (snapshot?.get("androidPackages") as? List<*>)?.filterIsInstance<String>() ?: emptyList(),
                websiteDomains = (snapshot?.get("websiteDomains") as? List<*>)?.filterIsInstance<String>() ?: emptyList(),
                allowedWebsiteDomains = (snapshot?.get("allowedWebsiteDomains") as? List<*>)?.filterIsInstance<String>() ?: emptyList(),
            ))
        }
        val schedules = db.collection("users/$uid/schedules").addSnapshotListener { snapshot, error ->
            if (error != null) onError(error.localizedMessage ?: "Schedule sync failed")
            else onSchedules(snapshot?.documents?.map { document ->
                FocusSchedule(
                    id = document.id,
                    enabled = document.getBoolean("enabled") ?: true,
                    weekdays = (document.get("weekdays") as? List<*>)?.mapNotNull { (it as? Number)?.toInt() } ?: emptyList(),
                    localTime = document.getString("localTime") ?: "09:00",
                    timeZone = document.getString("timeZone") ?: ZoneId.systemDefault().id,
                    durationMinutes = document.getLong("durationMinutes")?.toInt() ?: 60,
                )
            } ?: emptyList())
        }
        return listOf(sessions, settings, schedules)
    }

    suspend fun startFocus(minutes: Int) {
        functions.getHttpsCallable("startFocus").call(mapOf("durationMinutes" to minutes, "source" to "android")).await()
    }

    suspend fun savePackages(settings: BlockingSettings, packages: List<String>) {
        val uid = requireNotNull(auth.currentUser?.uid)
        db.document("users/$uid/settings/blocking").set(
            mapOf(
                "androidPackages" to packages.sorted(),
                "websiteDomains" to settings.websiteDomains,
                "allowedWebsiteDomains" to settings.allowedWebsiteDomains,
                "updatedAt" to com.google.firebase.firestore.FieldValue.serverTimestamp(),
            ),
            SetOptions.merge(),
        ).await()
    }

    suspend fun addSchedule(schedule: FocusSchedule) {
        val uid = requireNotNull(auth.currentUser?.uid)
        db.collection("users/$uid/schedules").add(mapOf(
            "enabled" to true,
            "weekdays" to schedule.weekdays,
            "localTime" to schedule.localTime,
            "timeZone" to schedule.timeZone,
            "durationMinutes" to schedule.durationMinutes,
            "createdAt" to com.google.firebase.firestore.FieldValue.serverTimestamp(),
        )).await()
    }
}
