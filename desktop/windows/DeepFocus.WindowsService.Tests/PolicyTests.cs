using System.Buffers.Binary;
using DeepFocus.WindowsService;
using Xunit;

namespace DeepFocus.WindowsService.Tests;

public sealed class PolicyTests
{
    private static readonly long Now = 1_700_000_000_000;

    [Fact]
    public void ActivationCannotShortenOrRemoveActivePolicy()
    {
        var first = PolicyEngine.Activate(PolicyState.Empty, Request(Now + 120_000, ["one.example"], ["docs.one.example"]), "S-1-5-21-1", Now);
        var next = PolicyEngine.Activate(first, Request(Now + 60_000, ["two.example"], []), "S-1-5-21-1", Now);
        Assert.Equal(Now + 120_000, next.EndsAtMillis);
        Assert.Equal(["one.example", "two.example"], next.Domains);
        Assert.Empty(next.AllowedDomains);
    }

    [Fact]
    public void DifferentOwnerCannotReplaceActivePolicy()
    {
        var first = PolicyEngine.Activate(PolicyState.Empty, Request(Now + 60_000, ["one.example"], []), "S-1", Now);
        Assert.Throws<UnauthorizedAccessException>(() => PolicyEngine.Activate(first, Request(Now + 90_000, ["two.example"], []), "S-2", Now));
    }

    [Fact]
    public void MostSpecificBlockedAndAllowedRulesWin()
    {
        var state = new PolicyState(Now + 60_000, ["example.com", "private.docs.example.com"], ["docs.example.com"], "S-1");
        Assert.True(PolicyEngine.IsBlocked("www.example.com", state));
        Assert.False(PolicyEngine.IsBlocked("api.docs.example.com", state));
        Assert.True(PolicyEngine.IsBlocked("private.docs.example.com", state));
    }

    [Fact]
    public void RejectsMalformedDomainsAndOutsideExceptions()
    {
        Assert.Throws<ArgumentException>(() => PolicyEngine.Activate(PolicyState.Empty, Request(Now + 60_000, ["https://example.com"], []), "S-1", Now));
        Assert.Throws<ArgumentException>(() => PolicyEngine.Activate(PolicyState.Empty, Request(Now + 60_000, ["example.com"], ["outside.test"]), "S-1", Now));
    }

    [Fact]
    public void DnsQuestionParsesAndBlockedResponseIsNxdomain()
    {
        var query = Query("www.example.com");
        Assert.True(DnsProtocol.TryReadQuestion(query, out var hostname, out var end));
        Assert.Equal("www.example.com", hostname);
        var response = DnsProtocol.BuildError(query, end, 3);
        Assert.Equal(3, BinaryPrimitives.ReadUInt16BigEndian(response.AsSpan(2, 2)) & 0xf);
        Assert.Equal(0, BinaryPrimitives.ReadUInt16BigEndian(response.AsSpan(6, 2)));
    }

    [Fact]
    public void DnsParserRejectsCompressedOrTruncatedQuestions()
    {
        Assert.False(DnsProtocol.TryReadQuestion(new byte[10], out _, out _));
        var compressed = new byte[18];
        compressed[5] = 1;
        compressed[12] = 0xc0;
        Assert.False(DnsProtocol.TryReadQuestion(compressed, out _, out _));
    }

    [Fact]
    public async Task CoordinatorPersistsBeforeApplyingAndCleansUpAfterExpiry()
    {
        var store = new MemoryStore();
        var applier = new RecordingApplier();
        var coordinator = new PolicyCoordinator(store, applier);
        await coordinator.ActivateAsync(Request(Now + 1_000, ["example.com"], []), "S-1", Now, CancellationToken.None);
        Assert.Equal(Now + 1_000, store.State.EndsAtMillis);
        Assert.Equal(1, applier.ApplyCount);

        await coordinator.ReconcileAsync(Now + 1_001, CancellationToken.None);
        Assert.Equal(1, applier.RemoveCount);
        Assert.Equal(0, coordinator.Current.EndsAtMillis);
        Assert.True(store.Deleted);
    }

    [Fact]
    public async Task CoordinatorRecoversPersistedActiveStateAndLimitsNrptRechecks()
    {
        var store = new MemoryStore { State = new PolicyState(Now + 120_000, ["example.com"], [], "S-1") };
        var applier = new RecordingApplier();
        var coordinator = new PolicyCoordinator(store, applier);
        await coordinator.ReconcileAsync(Now, CancellationToken.None);
        await coordinator.ReconcileAsync(Now + 1_000, CancellationToken.None);
        await coordinator.ReconcileAsync(Now + 31_000, CancellationToken.None);
        Assert.Equal(2, applier.ApplyCount);
    }

    [Fact]
    public async Task CoordinatorSerializesConcurrentActivation()
    {
        var coordinator = new PolicyCoordinator(new MemoryStore(), new RecordingApplier());
        await Task.WhenAll(
            coordinator.ActivateAsync(Request(Now + 60_000, ["one.example"], []), "S-1", Now, CancellationToken.None),
            coordinator.ActivateAsync(Request(Now + 120_000, ["two.example"], []), "S-1", Now, CancellationToken.None));
        Assert.Equal(Now + 120_000, coordinator.Current.EndsAtMillis);
        Assert.Equal(["one.example", "two.example"], coordinator.Current.Domains);
    }

    [Fact]
    public async Task PipeFramingRequiresABoundedNewlineTerminatedRequest()
    {
        await using var valid = new MemoryStream(System.Text.Encoding.UTF8.GetBytes("{\"command\":\"activate\"}\nignored"));
        Assert.Equal("{\"command\":\"activate\"}", await ActivationPipeServer.ReadLineAsync(valid, CancellationToken.None));

        await using var incomplete = new MemoryStream(System.Text.Encoding.UTF8.GetBytes("{}"));
        await Assert.ThrowsAsync<ArgumentException>(() => ActivationPipeServer.ReadLineAsync(incomplete, CancellationToken.None));
    }

    private static ActivationRequest Request(long end, string[] domains, string[] allowed) => new("activate", domains, allowed, end);

    private static byte[] Query(string hostname)
    {
        var bytes = new List<byte>([0x12, 0x34, 0x01, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
        foreach (var label in hostname.Split('.')) { bytes.Add((byte)label.Length); bytes.AddRange(System.Text.Encoding.ASCII.GetBytes(label)); }
        bytes.AddRange([0, 0, 1, 0, 1]);
        return bytes.ToArray();
    }

    private sealed class MemoryStore : IStateStore
    {
        public PolicyState State { get; set; } = PolicyState.Empty;
        public bool Deleted { get; private set; }
        public PolicyState Load() => State;
        public void Save(PolicyState state) => State = state;
        public void Delete() { State = PolicyState.Empty; Deleted = true; }
    }

    private sealed class RecordingApplier : IPolicyApplier
    {
        public int ApplyCount { get; private set; }
        public int RemoveCount { get; private set; }
        public Task ApplyAsync(PolicyState state, CancellationToken cancellationToken) { ApplyCount++; return Task.CompletedTask; }
        public Task RemoveAsync(CancellationToken cancellationToken) { RemoveCount++; return Task.CompletedTask; }
    }
}
