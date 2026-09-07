using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Text.Json;

namespace DeepFocus.WindowsService;

public sealed class ActivationPipeServer(PolicyCoordinator policies, ILogger<ActivationPipeServer> logger) : BackgroundService
{
    public const string PipeName = "deep-focus";

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            NamedPipeServerStream? pipe = null;
            try
            {
                pipe = CreatePipe();
                await pipe.WaitForConnectionAsync(stoppingToken);
                _ = HandleAsync(pipe, stoppingToken);
                pipe = null;
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
            catch (Exception error) { logger.LogError(error, "Windows activation pipe failed."); }
            finally { pipe?.Dispose(); }
        }
    }

    private static NamedPipeServerStream CreatePipe()
    {
        var security = new PipeSecurity();
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), PipeAccessRights.FullControl, AccessControlType.Allow));
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null), PipeAccessRights.FullControl, AccessControlType.Allow));
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.AuthenticatedUserSid, null), PipeAccessRights.ReadWrite, AccessControlType.Allow));
        return NamedPipeServerStreamAcl.Create(PipeName, PipeDirection.InOut, 8, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 4096, 4096, security);
    }

    private async Task HandleAsync(NamedPipeServerStream pipe, CancellationToken cancellationToken)
    {
        using (pipe)
        {
            ActivationResponse response;
            try
            {
                var raw = await ReadLineAsync(pipe, cancellationToken);
                var request = JsonSerializer.Deserialize<ActivationRequest>(raw, new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
                    ?? throw new ArgumentException("The activation request is empty.");
                string? sid = null;
                pipe.RunAsClient(() => sid = WindowsIdentity.GetCurrent().User?.Value);
                if (sid is null) throw new UnauthorizedAccessException("The caller identity is unavailable.");
                var state = await policies.ActivateAsync(request, sid, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), cancellationToken);
                response = new(true, EndsAtMillis: state.EndsAtMillis, DomainCount: state.Domains.Length, AllowedDomainCount: state.AllowedDomains.Length);
            }
            catch (Exception error)
            {
                var message = error.Message.Length <= 240 ? error.Message : error.Message[..240];
                response = new(false, message);
            }
            var output = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(response, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase }) + "\n");
            await pipe.WriteAsync(output, cancellationToken);
            await pipe.FlushAsync(cancellationToken);
        }
    }

    internal static async Task<string> ReadLineAsync(Stream stream, CancellationToken cancellationToken)
    {
        var bytes = new List<byte>();
        var buffer = new byte[1024];
        while (bytes.Count <= 65536)
        {
            var count = await stream.ReadAsync(buffer, cancellationToken);
            if (count == 0) break;
            var newline = Array.IndexOf(buffer, (byte)'\n', 0, count);
            bytes.AddRange(buffer.AsSpan(0, newline >= 0 ? newline : count).ToArray());
            if (newline >= 0) return Encoding.UTF8.GetString(bytes.ToArray());
        }
        throw new ArgumentException("The activation request is too large or incomplete.");
    }
}
