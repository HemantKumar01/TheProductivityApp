namespace DeepFocus.WindowsService;

public interface IPolicyApplier
{
    Task ApplyAsync(PolicyState state, CancellationToken cancellationToken);
    Task RemoveAsync(CancellationToken cancellationToken);
}

public sealed class PolicyCoordinator
{
    private readonly IStateStore _store;
    private readonly IPolicyApplier _applier;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private PolicyState _current;
    private string? _appliedFingerprint;
    private long _lastApplyMillis;

    public PolicyCoordinator(IStateStore store, IPolicyApplier applier)
    {
        _store = store;
        _applier = applier;
        _current = store.Load();
    }

    public PolicyState Current
    {
        get => Volatile.Read(ref _current);
    }

    public async Task<PolicyState> ActivateAsync(ActivationRequest request, string ownerSid, long nowMillis, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            if (_current.EndsAtMillis != 0 && _current.EndsAtMillis <= nowMillis)
            {
                await _applier.RemoveAsync(cancellationToken);
                _current = PolicyState.Empty;
                _store.Delete();
            }
            var next = PolicyEngine.Activate(_current, request, ownerSid, nowMillis);
            _store.Save(next); // Persist first so a crash cannot lose an accepted deadline.
            _current = next;
            await _applier.ApplyAsync(next, cancellationToken);
            _appliedFingerprint = Fingerprint(next);
            _lastApplyMillis = nowMillis;
            return next;
        }
        finally { _gate.Release(); }
    }

    public async Task ReconcileAsync(long nowMillis, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            if (_current.EndsAtMillis == 0) return;
            if (_current.EndsAtMillis <= nowMillis)
            {
                await _applier.RemoveAsync(cancellationToken);
                _current = PolicyState.Empty;
                _store.Delete();
                _appliedFingerprint = null;
            }
            else if (_appliedFingerprint != Fingerprint(_current) || nowMillis - _lastApplyMillis >= 30_000)
            {
                await _applier.ApplyAsync(_current, cancellationToken);
                _appliedFingerprint = Fingerprint(_current);
                _lastApplyMillis = nowMillis;
            }
        }
        finally { _gate.Release(); }
    }

    private static string Fingerprint(PolicyState state) => string.Join('|', state.Domains);
}
