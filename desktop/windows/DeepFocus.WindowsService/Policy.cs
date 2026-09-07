using System.Text.RegularExpressions;

namespace DeepFocus.WindowsService;

public sealed record PolicyState(long EndsAtMillis, string[] Domains, string[] AllowedDomains, string? OwnerSid)
{
    public static readonly PolicyState Empty = new(0, [], [], null);
}

public sealed record ActivationRequest(string? Command, string[]? Domains, string[]? AllowedDomains, long EndsAtMillis);
public sealed record ActivationResponse(bool Ok, string? Error = null, long? EndsAtMillis = null, int? DomainCount = null, int? AllowedDomainCount = null);

public static partial class PolicyEngine
{
    [GeneratedRegex("^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$", RegexOptions.CultureInvariant)]
    private static partial Regex DomainPattern();

    public static PolicyState Activate(PolicyState current, ActivationRequest request, string ownerSid, long nowMillis)
    {
        if (!string.Equals(request.Command, "activate", StringComparison.Ordinal))
            throw new ArgumentException("Only the activate command is supported.");
        if (request.EndsAtMillis <= nowMillis)
            throw new ArgumentException("The focus deadline must be in the future.");

        var domains = Normalize(request.Domains);
        var allowed = Normalize(request.AllowedDomains);
        if (domains.Any(domain => !DomainPattern().IsMatch(domain)))
            throw new ArgumentException("Every blocklist entry must be a valid domain.");
        if (allowed.Any(domain => !DomainPattern().IsMatch(domain)))
            throw new ArgumentException("Every whitelist entry must be a valid subdomain.");
        if (allowed.Any(item => !domains.Any(root => IsStrictSubdomain(item, root))))
            throw new ArgumentException("Every whitelist entry must be inside a blocked domain.");

        if (current.EndsAtMillis <= nowMillis) current = PolicyState.Empty;
        if (current.EndsAtMillis == 0)
            return new PolicyState(request.EndsAtMillis, domains, allowed, ownerSid);
        if (!string.Equals(current.OwnerSid, ownerSid, StringComparison.OrdinalIgnoreCase))
            throw new UnauthorizedAccessException("A different local user owns the active focus session.");

        return new PolicyState(
            Math.Max(current.EndsAtMillis, request.EndsAtMillis),
            current.Domains.Union(domains, StringComparer.Ordinal).Order().ToArray(),
            current.AllowedDomains.Intersect(allowed, StringComparer.Ordinal).Order().ToArray(),
            current.OwnerSid);
    }

    public static bool IsBlocked(string hostname, PolicyState state)
    {
        var name = hostname.TrimEnd('.').ToLowerInvariant();
        var blockedSpecificity = state.Domains.Where(domain => IsWithin(name, domain)).Select(domain => domain.Length).DefaultIfEmpty(-1).Max();
        var allowedSpecificity = state.AllowedDomains.Where(domain => IsWithin(name, domain)).Select(domain => domain.Length).DefaultIfEmpty(-1).Max();
        return blockedSpecificity >= 0 && blockedSpecificity >= allowedSpecificity;
    }

    private static bool IsWithin(string hostname, string domain) => hostname == domain || hostname.EndsWith($".{domain}", StringComparison.Ordinal);
    private static bool IsStrictSubdomain(string hostname, string domain) => hostname.EndsWith($".{domain}", StringComparison.Ordinal);

    private static string[] Normalize(IEnumerable<string>? values) => (values ?? [])
        .Select(value => value.Trim().TrimEnd('.').ToLowerInvariant())
        .Distinct(StringComparer.Ordinal)
        .Order()
        .ToArray();
}
