package dev.deepfocus.app

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.Query

class FocusAccessibilityService : AccessibilityService() {
    private var blockedPackages: Set<String> = emptySet()
    private var activeUntilMillis: Long = 0
    private val listeners = mutableListOf<ListenerRegistration>()
    private val auth by lazy { FirebaseAuth.getInstance() }
    private val authListener = FirebaseAuth.AuthStateListener { attachListeners() }

    override fun onServiceConnected() {
        super.onServiceConnected()
        auth.addAuthStateListener(authListener)
    }

    private fun attachListeners() {
        listeners.forEach { it.remove() }
        listeners.clear()
        val uid = auth.currentUser?.uid ?: return
        val db = FirebaseFirestore.getInstance()
        listeners += db.document("users/$uid/settings/blocking").addSnapshotListener { snapshot, _ ->
            blockedPackages = (snapshot?.get("androidPackages") as? List<*>)?.filterIsInstance<String>()?.toSet() ?: emptySet()
        }
        listeners += db.collection("users/$uid/sessions")
            .orderBy("startsAt", Query.Direction.DESCENDING).limit(10)
            .addSnapshotListener { snapshot, _ ->
                val now = System.currentTimeMillis()
                activeUntilMillis = snapshot?.documents
                    ?.mapNotNull { sessionFrom(it.id, it.data ?: emptyMap()) }
                    ?.filter { it.startsAtMillis <= now && it.endsAtMillis > now }
                    ?.maxOfOrNull { it.endsAtMillis } ?: 0
            }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event?.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val foregroundPackage = event.packageName?.toString() ?: return
        if (System.currentTimeMillis() < activeUntilMillis && foregroundPackage in blockedPackages) {
            performGlobalAction(GLOBAL_ACTION_HOME)
        }
    }

    override fun onInterrupt() = Unit

    override fun onDestroy() {
        auth.removeAuthStateListener(authListener)
        listeners.forEach { it.remove() }
        listeners.clear()
        super.onDestroy()
    }
}
