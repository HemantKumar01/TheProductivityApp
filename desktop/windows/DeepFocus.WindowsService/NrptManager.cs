using System.Diagnostics;
using System.Text;

namespace DeepFocus.WindowsService;

public sealed class NrptManager : IPolicyApplier
{
    private const string Tag = "Deep Focus managed rule";
    private const string Resolver = "127.0.0.2";

    public Task ApplyAsync(PolicyState state, CancellationToken cancellationToken)
    {
        var namespaces = state.Domains.SelectMany(domain => new[] { domain, $".{domain}" }).Distinct().Order();
        var literals = string.Join(",", namespaces.Select(PowerShellLiteral));
        var script = $"$tag={PowerShellLiteral(Tag)};$wanted=@({literals});" +
            "$existing=@(Get-DnsClientNrptRule -ErrorAction SilentlyContinue|Where-Object{$_.Comment -eq $tag});" +
            "foreach($ns in $wanted){if(-not ($existing|Where-Object{@($_.Namespace) -contains $ns})){" +
            $"Add-DnsClientNrptRule -Namespace $ns -NameServers {PowerShellLiteral(Resolver)} -Comment $tag -ErrorAction Stop|Out-Null" +
            "}}";
        return RunPowerShellAsync(script, cancellationToken);
    }

    public Task RemoveAsync(CancellationToken cancellationToken) => RunPowerShellAsync(
        $"Get-DnsClientNrptRule -ErrorAction SilentlyContinue|Where-Object{{$_.Comment -eq {PowerShellLiteral(Tag)}}}|Remove-DnsClientNrptRule -Force -ErrorAction Stop",
        cancellationToken);

    private static string PowerShellLiteral(string value) => $"'{value.Replace("'", "''")}'";

    private static async Task RunPowerShellAsync(string script, CancellationToken cancellationToken)
    {
        var encoded = Convert.ToBase64String(Encoding.Unicode.GetBytes(script));
        using var process = Process.Start(new ProcessStartInfo
        {
            FileName = Path.Combine(Environment.SystemDirectory, "WindowsPowerShell", "v1.0", "powershell.exe"),
            Arguments = $"-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand {encoded}",
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardError = true,
            RedirectStandardOutput = true
        }) ?? throw new InvalidOperationException("Could not start Windows PowerShell.");
        var errorTask = process.StandardError.ReadToEndAsync(cancellationToken);
        await process.WaitForExitAsync(cancellationToken);
        var error = (await errorTask).Trim();
        if (process.ExitCode != 0) throw new InvalidOperationException(string.IsNullOrEmpty(error) ? "Windows DNS policy update failed." : error[..Math.Min(error.Length, 240)]);
    }
}
