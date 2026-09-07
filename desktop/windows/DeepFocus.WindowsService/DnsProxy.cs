using System.Buffers.Binary;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;

namespace DeepFocus.WindowsService;

public sealed class DnsProxy(PolicyCoordinator policies, ILogger<DnsProxy> logger) : IHostedService
{
    private readonly List<Task> _tasks = [];
    private CancellationTokenSource? _lifetime;
    private UdpClient? _udp;
    private TcpListener? _tcp;

    public Task StartAsync(CancellationToken cancellationToken)
    {
        _lifetime = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var endpoint = new IPEndPoint(IPAddress.Parse("127.0.0.2"), 53);
        _udp = new UdpClient(endpoint);
        _tcp = new TcpListener(endpoint);
        _tcp.Start();
        _tasks.Add(RunUdpAsync(_lifetime.Token));
        _tasks.Add(RunTcpAsync(_lifetime.Token));
        return Task.CompletedTask;
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        _lifetime?.Cancel();
        _udp?.Dispose();
        _tcp?.Stop();
        try { await Task.WhenAll(_tasks).WaitAsync(cancellationToken); } catch (Exception) { }
    }

    private async Task RunUdpAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                var request = await _udp!.ReceiveAsync(cancellationToken);
                _ = Task.Run(async () =>
                {
                    var response = await ResolveAsync(request.Buffer, false, cancellationToken);
                    await _udp.SendAsync(response, request.RemoteEndPoint, cancellationToken);
                }, cancellationToken);
            }
            catch (Exception error) when (error is OperationCanceledException or ObjectDisposedException or SocketException)
            {
                if (!cancellationToken.IsCancellationRequested) logger.LogWarning(error, "Windows DNS UDP listener failed.");
            }
        }
    }

    private async Task RunTcpAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                var client = await _tcp!.AcceptTcpClientAsync(cancellationToken);
                _ = HandleTcpAsync(client, cancellationToken);
            }
            catch (Exception error) when (error is OperationCanceledException or ObjectDisposedException or SocketException)
            {
                if (!cancellationToken.IsCancellationRequested) logger.LogWarning(error, "Windows DNS TCP listener failed.");
            }
        }
    }

    private async Task HandleTcpAsync(TcpClient client, CancellationToken cancellationToken)
    {
        using (client)
        {
            var stream = client.GetStream();
            var lengthBytes = new byte[2];
            if (!await ReadExactlyAsync(stream, lengthBytes, cancellationToken)) return;
            var length = BinaryPrimitives.ReadUInt16BigEndian(lengthBytes);
            if (length is < 12 or > 65535) return;
            var query = new byte[length];
            if (!await ReadExactlyAsync(stream, query, cancellationToken)) return;
            var response = await ResolveAsync(query, true, cancellationToken);
            BinaryPrimitives.WriteUInt16BigEndian(lengthBytes, checked((ushort)response.Length));
            await stream.WriteAsync(lengthBytes, cancellationToken);
            await stream.WriteAsync(response, cancellationToken);
        }
    }

    private async Task<byte[]> ResolveAsync(byte[] query, bool tcp, CancellationToken cancellationToken)
    {
        if (!DnsProtocol.TryReadQuestion(query, out var hostname, out var questionEnd)) return [];
        if (PolicyEngine.IsBlocked(hostname, policies.Current)) return DnsProtocol.BuildError(query, questionEnd, 3);
        try { return await ForwardAsync(query, tcp, cancellationToken); }
        catch (Exception error) when (error is SocketException or IOException or OperationCanceledException)
        {
            logger.LogWarning(error, "Could not forward an allowed DNS request.");
            return DnsProtocol.BuildError(query, questionEnd, 2);
        }
    }

    private static async Task<byte[]> ForwardAsync(byte[] query, bool tcp, CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(3));
        var upstream = GetUpstreamServers().FirstOrDefault() ?? throw new IOException("No upstream DNS server is available.");
        if (!tcp)
        {
            using var client = new UdpClient(upstream.AddressFamily);
            await client.SendAsync(query, new IPEndPoint(upstream, 53), timeout.Token);
            return (await client.ReceiveAsync(timeout.Token)).Buffer;
        }
        using var tcpClient = new TcpClient(upstream.AddressFamily);
        await tcpClient.ConnectAsync(upstream, 53, timeout.Token);
        var stream = tcpClient.GetStream();
        var prefix = new byte[2];
        BinaryPrimitives.WriteUInt16BigEndian(prefix, checked((ushort)query.Length));
        await stream.WriteAsync(prefix, timeout.Token);
        await stream.WriteAsync(query, timeout.Token);
        if (!await ReadExactlyAsync(stream, prefix, timeout.Token)) throw new IOException("The upstream DNS response ended early.");
        var length = BinaryPrimitives.ReadUInt16BigEndian(prefix);
        var response = new byte[length];
        if (!await ReadExactlyAsync(stream, response, timeout.Token)) throw new IOException("The upstream DNS response ended early.");
        return response;
    }

    private static IEnumerable<IPAddress> GetUpstreamServers() => NetworkInterface.GetAllNetworkInterfaces()
        .Where(item => item.OperationalStatus == OperationalStatus.Up && item.NetworkInterfaceType != NetworkInterfaceType.Loopback)
        .SelectMany(item => item.GetIPProperties().DnsAddresses)
        .Where(address => !IPAddress.IsLoopback(address) && !address.Equals(IPAddress.Any) && !address.Equals(IPAddress.IPv6Any))
        .Distinct();

    private static async Task<bool> ReadExactlyAsync(Stream stream, Memory<byte> target, CancellationToken cancellationToken)
    {
        var read = 0;
        while (read < target.Length)
        {
            var count = await stream.ReadAsync(target[read..], cancellationToken);
            if (count == 0) return false;
            read += count;
        }
        return true;
    }
}
