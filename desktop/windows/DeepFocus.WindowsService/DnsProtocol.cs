using System.Buffers.Binary;
using System.Text;

namespace DeepFocus.WindowsService;

public static class DnsProtocol
{
    public static bool TryReadQuestion(ReadOnlySpan<byte> packet, out string hostname, out int questionEnd)
    {
        hostname = "";
        questionEnd = 0;
        if (packet.Length < 17 || BinaryPrimitives.ReadUInt16BigEndian(packet[4..6]) != 1) return false;
        var labels = new List<string>();
        var offset = 12;
        while (offset < packet.Length)
        {
            var length = packet[offset++];
            if (length == 0) break;
            if (length > 63 || (length & 0xc0) != 0 || offset + length > packet.Length) return false;
            labels.Add(Encoding.ASCII.GetString(packet.Slice(offset, length)));
            offset += length;
        }
        if (labels.Count == 0 || offset + 4 > packet.Length) return false;
        hostname = string.Join('.', labels).ToLowerInvariant();
        questionEnd = offset + 4;
        return true;
    }

    public static byte[] BuildError(ReadOnlySpan<byte> query, int questionEnd, byte responseCode)
    {
        var response = query[..questionEnd].ToArray();
        var queryFlags = BinaryPrimitives.ReadUInt16BigEndian(query[2..4]);
        var flags = (ushort)(0x8000 | 0x0080 | (queryFlags & 0x0100) | responseCode);
        BinaryPrimitives.WriteUInt16BigEndian(response.AsSpan(2, 2), flags);
        response.AsSpan(6, 6).Clear();
        return response;
    }
}
