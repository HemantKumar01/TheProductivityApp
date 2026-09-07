package dev.deepfocus.app

import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.delay
import java.time.ZoneId
import java.util.Locale

private val Ink = Color(0xFF171A16)
private val Surface = Color(0xFF20241E)
private val Line = Color(0xFF3B4038)
private val Paper = Color(0xFFECEEE5)
private val Muted = Color(0xFFAEB3A7)
private val Signal = Color(0xFFC7FF4A)
private val Danger = Color(0xFFFF8D7B)
private val RaisedSurface = Color(0xFF292D27)

private val DeepFocusScheme = darkColorScheme(
    primary = Signal,
    onPrimary = Ink,
    primaryContainer = Color(0xFF394A16),
    onPrimaryContainer = Color(0xFFE3FFAA),
    secondary = Paper,
    onSecondary = Ink,
    secondaryContainer = RaisedSurface,
    onSecondaryContainer = Paper,
    tertiary = Muted,
    onTertiary = Ink,
    tertiaryContainer = Color(0xFF343A31),
    onTertiaryContainer = Paper,
    background = Ink,
    onBackground = Paper,
    surface = Surface,
    onSurface = Paper,
    surfaceVariant = RaisedSurface,
    onSurfaceVariant = Muted,
    surfaceTint = Signal,
    inverseSurface = Paper,
    inverseOnSurface = Ink,
    inversePrimary = Color(0xFF4B6500),
    outline = Line,
    outlineVariant = Color(0xFF30352E),
    error = Danger,
    onError = Ink,
    errorContainer = Color(0xFF5A211C),
    onErrorContainer = Color(0xFFFFDAD4),
    scrim = Color.Black,
)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            MaterialTheme(colorScheme = DeepFocusScheme, typography = Typography()) {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = DeepFocusScheme.background,
                    contentColor = DeepFocusScheme.onBackground,
                ) {
                    val viewModel: MainViewModel = viewModel()
                    DeepFocusApp(viewModel)
                }
            }
        }
    }
}

@Composable
private fun DeepFocusApp(viewModel: MainViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    when {
        !state.authResolved -> LoadingScreen()
        state.user == null -> AuthScreen(state, viewModel)
        else -> HomeScreen(state, viewModel)
    }
}

@Composable
private fun LoadingScreen() {
    Box(Modifier.fillMaxSize().background(Ink), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = Signal, strokeWidth = 2.dp)
    }
}

@Composable
private fun AuthScreen(state: AppState, viewModel: MainViewModel) {
    val context = LocalContext.current
    Column(
        modifier = Modifier.fillMaxSize().background(Ink).statusBarsPadding().navigationBarsPadding().padding(24.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Brand()
        Spacer(Modifier.height(56.dp))
        Eyebrow("A CONTRACT WITH YOUR ATTENTION")
        Text(
            "Return to\ndeep work.",
            fontSize = 48.sp, lineHeight = 48.sp, fontWeight = FontWeight.Bold, letterSpacing = (-2).sp,
        )
        Text("One switch across Android and Linux. No early exits, no bargaining.", color = Muted, lineHeight = 24.sp, modifier = Modifier.padding(top = 16.dp, bottom = 36.dp))
        state.error?.let { Text(it, color = Danger, fontSize = 13.sp, modifier = Modifier.padding(top = 10.dp)) }
        Button(
            onClick = { viewModel.signInWithGoogle(context) },
            enabled = !state.busy,
            modifier = Modifier.fillMaxWidth().height(56.dp),
            shape = RoundedCornerShape(7.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Color.White, contentColor = Color(0xFF252822)),
        ) { Icon(painterResource(R.drawable.ic_google), null, tint = Color.Unspecified, modifier = Modifier.size(20.dp)); Spacer(Modifier.width(12.dp)); Text(if (state.busy) "Waiting for Google…" else "Continue with Google", fontWeight = FontWeight.Bold) }
        Text("Choose the same account on every device to keep your focus data in sync.", color = Muted, fontSize = 12.sp, lineHeight = 18.sp, modifier = Modifier.padding(top = 14.dp))
    }
}

private enum class Tab { Focus, Schedule, Blocklist }

@Composable
private fun HomeScreen(state: AppState, viewModel: MainViewModel) {
    var tab by remember { mutableStateOf(Tab.Focus) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) { now = System.currentTimeMillis(); delay(1_000) } }
    val active = state.sessions.firstOrNull { it.startsAtMillis <= now && it.endsAtMillis > now }
    val context = LocalContext.current
    val accessibilityEnabled = remember { mutableStateOf(isAccessibilityEnabled(context)) }
    DisposableEffect(Unit) {
        val observer = object : android.database.ContentObserver(null) {
            override fun onChange(selfChange: Boolean) { accessibilityEnabled.value = isAccessibilityEnabled(context) }
        }
        context.contentResolver.registerContentObserver(Settings.Secure.getUriFor(Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES), false, observer)
        onDispose { context.contentResolver.unregisterContentObserver(observer) }
    }

    Scaffold(
        containerColor = Ink,
        contentColor = Paper,
        bottomBar = {
            NavigationBar(containerColor = Color(0xFF141713)) {
                NavigationBarItem(selected = tab == Tab.Focus, onClick = { tab = Tab.Focus }, icon = { Icon(Icons.Outlined.Timer, null) }, label = { Text("Focus") }, colors = deepFocusNavigationColors())
                NavigationBarItem(selected = tab == Tab.Schedule, onClick = { tab = Tab.Schedule }, icon = { Icon(Icons.Outlined.EventRepeat, null) }, label = { Text("Schedule") }, colors = deepFocusNavigationColors())
                NavigationBarItem(selected = tab == Tab.Blocklist, onClick = { tab = Tab.Blocklist }, icon = { Icon(Icons.Outlined.Shield, null) }, label = { Text("Blocklist") }, colors = deepFocusNavigationColors())
            }
        },
        snackbarHost = {
            state.error?.let {
                Snackbar(modifier = Modifier.padding(16.dp), action = { TextButton(onClick = viewModel::clearError) { Text("Dismiss") } }) { Text(it) }
            }
        },
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            when (tab) {
                Tab.Focus -> FocusScreen(state, active, now, accessibilityEnabled.value, viewModel, onEnableAccessibility = { context.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) })
                Tab.Schedule -> ScheduleScreen(state, active != null, viewModel)
                Tab.Blocklist -> BlocklistScreen(state, active != null, viewModel)
            }
        }
    }
}

@Composable
private fun deepFocusNavigationColors() = NavigationBarItemDefaults.colors(
    selectedIconColor = Ink,
    selectedTextColor = Paper,
    indicatorColor = Signal,
    unselectedIconColor = Muted,
    unselectedTextColor = Muted,
)

@Composable
private fun FocusScreen(state: AppState, active: FocusSession?, now: Long, accessibilityEnabled: Boolean, viewModel: MainViewModel, onEnableAccessibility: () -> Unit) {
    var duration by remember { mutableIntStateOf(45) }
    val metrics = remember(state.sessions, now) { calculateMetrics(state.sessions, now) }
    LazyColumn(contentPadding = PaddingValues(20.dp, 30.dp, 20.dp, 48.dp), verticalArrangement = Arrangement.spacedBy(28.dp)) {
        item {
            Eyebrow("YOUR ATTENTION, PROTECTED")
            Text(if (active != null) "Stay with it." else "Make room for\ndeep work.", fontSize = 42.sp, lineHeight = 42.sp, fontWeight = FontWeight.Bold, letterSpacing = (-1.5).sp, modifier = Modifier.semantics { heading() })
            Text(if (active != null) "Your blocklists are active on every connected device." else "Choose a duration. Once it begins, the session runs to completion.", color = Muted, lineHeight = 23.sp, modifier = Modifier.padding(top = 12.dp))
        }
        if (!accessibilityEnabled) item {
            Surface(shape = RoundedCornerShape(9.dp), border = BorderStroke(1.dp, Danger.copy(alpha = .5f)), color = Danger.copy(alpha = .06f)) {
                Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.WarningAmber, null, tint = Danger)
                    Column(Modifier.weight(1f).padding(horizontal = 12.dp)) { Text("App blocking needs access", fontWeight = FontWeight.Bold); Text("Enable the Deep Focus accessibility service.", color = Muted, fontSize = 13.sp) }
                    TextButton(onClick = onEnableAccessibility) { Text("Enable") }
                }
            }
        }
        item {
            Surface(shape = RoundedCornerShape(11.dp), border = BorderStroke(1.dp, if (active != null) Signal.copy(alpha = .5f) else Line), color = Surface) {
                Column(Modifier.padding(24.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Outlined.Lock, null, tint = Signal, modifier = Modifier.size(17.dp)); Spacer(Modifier.width(8.dp)); Eyebrow(if (active != null) "FOCUS LOCKED" else "READY", bottom = 0.dp) }
                    Text(if (active != null) formatClock(active.endsAtMillis - now) else "%02d:00".format(duration), fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Medium, fontSize = 62.sp, letterSpacing = (-4).sp, modifier = Modifier.padding(top = 24.dp))
                    Text(if (active != null) "Runs until ${java.text.SimpleDateFormat("HH:mm", Locale.getDefault()).format(active.endsAtMillis)}" else "minutes of uninterrupted attention", color = Muted, fontSize = 13.sp)
                    Spacer(Modifier.height(26.dp))
                    if (active == null) {
                        Row(horizontalArrangement = Arrangement.spacedBy(7.dp), modifier = Modifier.fillMaxWidth()) { listOf(25, 45, 60, 90).forEach { value -> FilterChip(selected = duration == value, onClick = { duration = value }, label = { Text("$value") }, modifier = Modifier.weight(1f)) } }
                        Button(onClick = { viewModel.startFocus(duration) }, enabled = !state.busy && accessibilityEnabled, modifier = Modifier.fillMaxWidth().height(56.dp).padding(top = 8.dp), shape = RoundedCornerShape(7.dp)) { Text(if (state.busy) "Starting…" else "Begin focus", fontWeight = FontWeight.Bold); Spacer(Modifier.width(8.dp)); Icon(Icons.AutoMirrored.Outlined.ArrowForward, null) }
                    } else Row(verticalAlignment = Alignment.CenterVertically) { Box(Modifier.size(8.dp).background(Signal, CircleShape)); Spacer(Modifier.width(10.dp)); Text("This session cannot be ended early", color = Muted, fontSize = 12.sp) }
                }
            }
        }
        item { Eyebrow("MEASURED, NOT GAMIFIED"); Text("Today at a glance", fontSize = 22.sp, fontWeight = FontWeight.Bold) }
        item {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) { MetricCard("Focus today", formatDuration(metrics.todayMillis), Modifier.weight(1f)); MetricCard("Continuous", formatDuration(metrics.continuousMillis), Modifier.weight(1f)) }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) { MetricCard("Longest", formatDuration(metrics.longestMillis), Modifier.weight(1f)); MetricCard("Complete", metrics.completedCount.toString(), Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun MetricCard(label: String, value: String, modifier: Modifier = Modifier) {
    Surface(modifier.height(116.dp), shape = RoundedCornerShape(8.dp), border = BorderStroke(1.dp, Line), color = Surface) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.SpaceBetween) { Text(label, color = Muted, fontSize = 12.sp); Text(value, fontFamily = FontFamily.Monospace, fontSize = 24.sp, fontWeight = FontWeight.Medium) }
    }
}

@Composable
private fun ScheduleScreen(state: AppState, active: Boolean, viewModel: MainViewModel) {
    var time by remember { mutableStateOf("09:00") }; var duration by remember { mutableIntStateOf(60) }; var days by remember { mutableStateOf(setOf(1, 2, 3, 4, 5)) }
    LazyColumn(contentPadding = PaddingValues(20.dp, 30.dp, 20.dp, 48.dp), verticalArrangement = Arrangement.spacedBy(24.dp)) {
        item { Eyebrow("RITUAL BEATS WILLPOWER"); Text("Reserve your\nbest hours.", fontSize = 42.sp, lineHeight = 42.sp, fontWeight = FontWeight.Bold, letterSpacing = (-1.5).sp, modifier = Modifier.semantics { heading() }); Text("Schedules begin in the backend and arrive on every device.", color = Muted, modifier = Modifier.padding(top = 12.dp)) }
        item {
            Surface(shape = RoundedCornerShape(10.dp), border = BorderStroke(1.dp, Line), color = Surface) {
                Column(Modifier.padding(20.dp)) {
                    Text("New schedule", fontSize = 20.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(20.dp))
                    OutlinedTextField(time, { time = it }, label = { Text("Start time (24h)") }, supportingText = { Text("Example: 09:30") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    Text("Repeat on", color = Muted, fontSize = 13.sp, modifier = Modifier.padding(top = 12.dp, bottom = 8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.fillMaxWidth()) { listOf("M", "T", "W", "T", "F", "S", "S").forEachIndexed { index, label -> val day = index + 1; FilterChip(days.contains(day), { days = if (days.contains(day)) days - day else days + day }, { Text(label) }, modifier = Modifier.weight(1f)) } }
                    Text("Duration", color = Muted, fontSize = 13.sp, modifier = Modifier.padding(top = 16.dp, bottom = 8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) { listOf(45, 60, 90).forEach { value -> FilterChip(duration == value, { duration = value }, { Text("$value min") }) } }
                    Button(onClick = { viewModel.addSchedule(FocusSchedule("", weekdays = days.sorted(), localTime = time, timeZone = ZoneId.systemDefault().id, durationMinutes = duration)) }, enabled = !state.busy && days.isNotEmpty() && Regex("^([01]\\d|2[0-3]):[0-5]\\d$").matches(time), modifier = Modifier.fillMaxWidth().height(56.dp).padding(top = 8.dp), shape = RoundedCornerShape(7.dp)) { Icon(Icons.Outlined.Add, null); Spacer(Modifier.width(8.dp)); Text("Add schedule", fontWeight = FontWeight.Bold) }
                }
            }
        }
        if (active) item { LockNote("The current focus session remains unchanged.") }
        item { Text("Saved schedules", fontSize = 20.sp, fontWeight = FontWeight.Bold) }
        if (state.schedules.isEmpty()) item { Text("No repeating sessions yet.", color = Muted) }
        items(state.schedules, key = { it.id }) { schedule ->
            Surface(shape = RoundedCornerShape(8.dp), border = BorderStroke(1.dp, Line), color = Surface) {
                Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(schedule.localTime, fontFamily = FontFamily.Monospace, fontSize = 22.sp)
                    Column(Modifier.weight(1f).padding(horizontal = 16.dp)) { Text(formatDays(schedule.weekdays), fontWeight = FontWeight.Bold); Text("${schedule.durationMinutes} min", color = Muted, fontSize = 12.sp) }
                    Surface(color = Signal, shape = CircleShape) { Text("ON", color = Ink, fontSize = 10.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 9.dp, vertical = 5.dp)) }
                    if (!active) {
                        IconButton(onClick = { viewModel.deleteSchedule(schedule.id) }) { Icon(Icons.Outlined.DeleteOutline, contentDescription = "Delete schedule", tint = Danger) }
                    }
                }
            }
        }
    }
}

@Composable
private fun BlocklistScreen(state: AppState, active: Boolean, viewModel: MainViewModel) {
    var query by remember { mutableStateOf("") }
    val filtered = remember(state.installedApps, query) { state.installedApps.filter { it.label.contains(query, true) || it.packageName.contains(query, true) } }
    LazyColumn(contentPadding = PaddingValues(20.dp, 30.dp, 20.dp, 48.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { Eyebrow("DEFINE THE BOUNDARY"); Text("Keep the noise\noutside.", fontSize = 42.sp, lineHeight = 42.sp, fontWeight = FontWeight.Bold, letterSpacing = (-1.5).sp, modifier = Modifier.semantics { heading() }); Text("Selected apps return to the launcher while focus is active.", color = Muted, modifier = Modifier.padding(top = 12.dp, bottom = 14.dp)) }
        if (active) item { LockNote("Blocklists are locked until this session finishes.") }
        item { OutlinedTextField(query, { query = it }, label = { Text("Search installed apps") }, leadingIcon = { Icon(Icons.Outlined.Search, null) }, singleLine = true, modifier = Modifier.fillMaxWidth()) }
        item { Text("${state.settings.androidPackages.size} apps blocked", color = Muted, fontSize = 13.sp, modifier = Modifier.padding(vertical = 8.dp)) }
        items(filtered, key = { it.packageName }) { app ->
            val checked = app.packageName in state.settings.androidPackages
            Surface(shape = RoundedCornerShape(8.dp), border = BorderStroke(1.dp, Line), color = Surface) {
                Row(Modifier.fillMaxWidth().heightIn(min = 68.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Surface(Modifier.size(38.dp), color = Ink, shape = CircleShape) { Box(contentAlignment = Alignment.Center) { Icon(Icons.Outlined.Apps, null, tint = Muted, modifier = Modifier.size(19.dp)) } }
                    Column(Modifier.weight(1f).padding(horizontal = 13.dp)) { Text(app.label, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis); Text(app.packageName, color = Muted, fontSize = 10.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                    Switch(checked, { viewModel.togglePackage(app.packageName) }, enabled = !active)
                }
            }
        }
    }
}

@Composable private fun Brand() { Row(verticalAlignment = Alignment.CenterVertically) { Icon(painterResource(R.drawable.ic_deep_focus_mark), null, tint = Color.Unspecified, modifier = Modifier.size(27.dp)); Spacer(Modifier.width(11.dp)); Text("DEEP FOCUS", fontFamily = FontFamily.Monospace, fontSize = 13.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.5.sp) } }
@Composable private fun Eyebrow(text: String, bottom: androidx.compose.ui.unit.Dp = 10.dp) { Text(text, color = Signal, fontFamily = FontFamily.Monospace, fontSize = 10.sp, letterSpacing = 1.2.sp, modifier = Modifier.padding(bottom = bottom)) }
@Composable private fun LockNote(text: String) { Surface(shape = RoundedCornerShape(7.dp), border = BorderStroke(1.dp, Signal.copy(alpha = .3f)), color = Signal.copy(alpha = .04f)) { Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Outlined.Lock, null, tint = Signal, modifier = Modifier.size(17.dp)); Spacer(Modifier.width(10.dp)); Text(text, color = Muted, fontSize = 12.sp) } } }
private fun formatClock(milliseconds: Long): String { val seconds = maxOf(0, (milliseconds + 999) / 1_000); return "%02d:%02d".format(seconds / 60, seconds % 60) }
private fun formatDuration(milliseconds: Long): String { val minutes = maxOf(0, milliseconds / 60_000); return if (minutes >= 60) "${minutes / 60}h ${"%02d".format(minutes % 60)}m" else "${minutes}m" }
private fun formatDays(days: List<Int>) = when { days.size == 7 -> "Every day"; days == listOf(1,2,3,4,5) -> "Weekdays"; else -> days.joinToString(", ") { listOf("", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")[it] } }
private fun isAccessibilityEnabled(context: android.content.Context): Boolean { val expected = "${context.packageName}/${FocusAccessibilityService::class.java.name}"; val enabled = Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false; return enabled.split(':').any { it.equals(expected, true) } }
