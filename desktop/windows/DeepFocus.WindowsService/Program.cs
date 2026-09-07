namespace DeepFocus.WindowsService;

public static class Program
{
    public static async Task<int> Main(string[] args)
    {
        var store = new FileStateStore();
        if (args.Contains("--status-active", StringComparer.OrdinalIgnoreCase))
        {
            return store.Load().EndsAtMillis > DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() ? 10 : 0;
        }

        if (args.Contains("--cleanup", StringComparer.OrdinalIgnoreCase))
        {
            await new NrptManager().RemoveAsync(CancellationToken.None);
            store.Delete();
            return 0;
        }

        var builder = Host.CreateApplicationBuilder(args);
        builder.Services.AddWindowsService(options => options.ServiceName = "DeepFocusBlocker");
        builder.Services.AddSingleton<IStateStore>(store);
        builder.Services.AddSingleton<IPolicyApplier, NrptManager>();
        builder.Services.AddSingleton<PolicyCoordinator>();
        builder.Services.AddHostedService<DnsProxy>();
        builder.Services.AddHostedService<ActivationPipeServer>();
        builder.Services.AddHostedService<PolicyWorker>();
        await builder.Build().RunAsync();
        return 0;
    }
}
