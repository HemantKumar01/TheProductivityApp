using System.Text.Json;

namespace DeepFocus.WindowsService;

public interface IStateStore
{
    PolicyState Load();
    void Save(PolicyState state);
    void Delete();
}

public sealed class FileStateStore : IStateStore
{
    private readonly string _path;

    public FileStateStore(string? path = null)
    {
        _path = path ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Deep Focus", "state.json");
    }

    public PolicyState Load()
    {
        try
        {
            var state = JsonSerializer.Deserialize<PolicyState>(File.ReadAllText(_path));
            return state is null ? PolicyState.Empty : state with
            {
                Domains = state.Domains ?? [],
                AllowedDomains = state.AllowedDomains ?? []
            };
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException)
        {
            return PolicyState.Empty;
        }
    }

    public void Save(PolicyState state)
    {
        var directory = Path.GetDirectoryName(_path)!;
        Directory.CreateDirectory(directory);
        var temporary = $"{_path}.{Guid.NewGuid():N}.tmp";
        File.WriteAllText(temporary, JsonSerializer.Serialize(state));
        File.Move(temporary, _path, true);
    }

    public void Delete()
    {
        if (File.Exists(_path)) File.Delete(_path);
    }
}
