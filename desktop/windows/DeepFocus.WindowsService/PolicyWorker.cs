namespace DeepFocus.WindowsService;

public sealed class PolicyWorker(PolicyCoordinator policies, ILogger<PolicyWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(1));
        do
        {
            try { await policies.ReconcileAsync(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
            catch (Exception error) { logger.LogError(error, "Could not reconcile the Windows focus policy; retrying."); }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
