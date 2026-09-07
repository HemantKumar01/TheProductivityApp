package dev.deepfocus.app

import android.app.Application
import android.content.Context
import android.content.Intent
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.NoCredentialException
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.auth.GoogleAuthProvider
import com.google.firebase.firestore.ListenerRegistration
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential.Companion.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

data class InstalledApp(val label: String, val packageName: String)

data class AppState(
    val user: FirebaseUser? = FirebaseAuth.getInstance().currentUser,
    val authResolved: Boolean = false,
    val sessions: List<FocusSession> = emptyList(),
    val settings: BlockingSettings = BlockingSettings(),
    val schedules: List<FocusSchedule> = emptyList(),
    val installedApps: List<InstalledApp> = emptyList(),
    val busy: Boolean = false,
    val error: String? = null,
)

class MainViewModel(application: Application) : AndroidViewModel(application) {
    private val auth = FirebaseAuth.getInstance()
    private val repository = FocusRepository(auth = auth)
    private val _state = MutableStateFlow(AppState())
    val state: StateFlow<AppState> = _state.asStateFlow()
    private var listeners: List<ListenerRegistration> = emptyList()
    private val authListener = FirebaseAuth.AuthStateListener { firebaseAuth ->
        _state.value = _state.value.copy(user = firebaseAuth.currentUser, authResolved = true)
        if (firebaseAuth.currentUser != null) attachData() else detachData()
    }

    init {
        auth.addAuthStateListener(authListener)
        loadInstalledApps()
    }

    private fun attachData() {
        detachData()
        listeners = repository.observe(
            onSessions = { _state.value = _state.value.copy(sessions = it) },
            onSettings = { _state.value = _state.value.copy(settings = it) },
            onSchedules = { _state.value = _state.value.copy(schedules = it) },
            onError = { _state.value = _state.value.copy(error = it) },
        )
    }

    private fun detachData() {
        listeners.forEach { it.remove() }
        listeners = emptyList()
        _state.value = _state.value.copy(sessions = emptyList(), schedules = emptyList())
    }

    private fun loadInstalledApps() {
        val packageManager = getApplication<Application>().packageManager
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val ownPackage = getApplication<Application>().packageName
        val apps = packageManager.queryIntentActivities(intent, 0).mapNotNull { info ->
            if (info.activityInfo.packageName == ownPackage) null
            else InstalledApp(info.loadLabel(packageManager).toString(), info.activityInfo.packageName)
        }.distinctBy { it.packageName }.sortedBy { it.label.lowercase() }
        _state.value = _state.value.copy(installedApps = apps)
    }

    fun signInWithGoogle(context: Context) = viewModelScope.launch {
        _state.value = _state.value.copy(busy = true, error = null)
        runCatching {
            val googleIdOption = GetGoogleIdOption.Builder()
                .setServerClientId(context.getString(R.string.default_web_client_id))
                .setFilterByAuthorizedAccounts(false)
                .setAutoSelectEnabled(false)
                .build()
            val request = GetCredentialRequest.Builder().addCredentialOption(googleIdOption).build()
            val credential = CredentialManager.create(context).getCredential(context, request).credential
            check(credential is CustomCredential && credential.type == TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
                "Google did not return an ID credential."
            }
            val googleToken = GoogleIdTokenCredential.createFrom(credential.data).idToken
            auth.signInWithCredential(GoogleAuthProvider.getCredential(googleToken, null)).await()
        }.onFailure { error ->
            val message = when (error) {
                is NoCredentialException -> "No Google account is available. Add an account to this device and make sure Google Play services is up to date."
                else -> error.localizedMessage ?: "Google sign-in failed. Please try again."
            }
            _state.value = _state.value.copy(error = message)
        }
        _state.value = _state.value.copy(busy = false)
    }

    fun signOut(context: Context) = viewModelScope.launch {
        auth.signOut()
        runCatching { CredentialManager.create(context).clearCredentialState(ClearCredentialStateRequest()) }
    }

    fun startFocus(minutes: Int) = viewModelScope.launch {
        _state.value = _state.value.copy(busy = true, error = null)
        runCatching { repository.startFocus(minutes) }
            .onFailure { _state.value = _state.value.copy(error = it.localizedMessage) }
        _state.value = _state.value.copy(busy = false)
    }

    fun togglePackage(packageName: String) = viewModelScope.launch {
        val state = _state.value
        if (state.sessions.any { it.startsAtMillis <= System.currentTimeMillis() && it.endsAtMillis > System.currentTimeMillis() }) return@launch
        val packages = state.settings.androidPackages.toMutableSet()
        if (!packages.add(packageName)) packages.remove(packageName)
        runCatching { repository.savePackages(state.settings, packages.toList()) }
            .onFailure { _state.value = _state.value.copy(error = it.localizedMessage) }
    }

    fun addSchedule(schedule: FocusSchedule) = viewModelScope.launch {
        _state.value = _state.value.copy(busy = true, error = null)
        runCatching { repository.addSchedule(schedule) }
            .onFailure { _state.value = _state.value.copy(error = it.localizedMessage) }
        _state.value = _state.value.copy(busy = false)
    }

    fun deleteSchedule(scheduleId: String) = viewModelScope.launch {
        val state = _state.value
        if (state.sessions.any { it.startsAtMillis <= System.currentTimeMillis() && it.endsAtMillis > System.currentTimeMillis() }) return@launch
        _state.value = _state.value.copy(busy = true, error = null)
        runCatching { repository.deleteSchedule(scheduleId) }
            .onFailure { _state.value = _state.value.copy(error = it.localizedMessage) }
        _state.value = _state.value.copy(busy = false)
    }

    fun clearError() { _state.value = _state.value.copy(error = null) }

    override fun onCleared() {
        detachData()
        auth.removeAuthStateListener(authListener)
        super.onCleared()
    }
}
