using System.Text.Json;
using Source.Data;

namespace Source
{
    internal static class SpecialRetention
    {
        public static void Mark(
            string databasePath,
            Dictionary<string, Item> items,
            Dictionary<string, Fluid> fluids)
        {
            if (string.IsNullOrEmpty(databasePath))
                throw new InvalidDataException("Database parser did not retain its source path");

            foreach (var item in items.Values)
                item?.GenerateId();
            foreach (var fluid in fluids.Values)
                fluid.GenerateId();

            var references = ReadReferences(databasePath, Visit);
            foreach (var goodsId in references)
            {
                if (goodsId.StartsWith("i:", StringComparison.Ordinal))
                {
                    var item = items.Values.FirstOrDefault(candidate => candidate?.id == goodsId);
                    if (item == null)
                        throw new InvalidDataException("Special sidecar references unknown item " + goodsId);
                    item.touched = true;
                }
                else if (goodsId.StartsWith("f:", StringComparison.Ordinal))
                {
                    if (!fluids.Values.Any(candidate => candidate.id == goodsId))
                        throw new InvalidDataException("Special sidecar references unknown fluid " + goodsId);
                }
                else if (goodsId.StartsWith("o:", StringComparison.Ordinal)
                    || goodsId.StartsWith("od~", StringComparison.Ordinal))
                {
                    // Named ore dictionaries are marked separately below.  The
                    // runtime overlay may expose either the browser-canonical
                    // ID (o:name) or NESQL's raw format-v5 ID (od~name).
                }
                else
                {
                    throw new InvalidDataException("Special sidecar has invalid goods ID " + goodsId);
                }
            }
        }

        public static void MarkOreDictionaries(
            string databasePath,
            Dictionary<string, PackConverter.ItemGroupBuilder> groups)
        {
            var references = ReadReferences(databasePath, VisitOreDictionaries);
            foreach (var name in references)
            {
                var normalized = name.StartsWith("o:", StringComparison.Ordinal)
                    || name.StartsWith("g:", StringComparison.Ordinal) ? name[2..]
                    : name.StartsWith("od~", StringComparison.Ordinal) ? name[3..] : name;
                var group = groups.Values.FirstOrDefault(candidate =>
                    candidate.oreDictNames.Contains(normalized)
                    || candidate.oreDictNames.Contains("o:" + normalized)
                    || candidate.oreDictNames.Contains("g:" + normalized));
                if (group == null)
                    throw new InvalidDataException("Special sidecar references unknown ore dictionary " + name);
                group.touched = true;
                group.MarkUsedItems();
            }
        }

        private static void Visit(JsonElement value, HashSet<string> references)
        {
            if (value.ValueKind == JsonValueKind.Array)
            {
                foreach (var child in value.EnumerateArray()) Visit(child, references);
                return;
            }
            if (value.ValueKind != JsonValueKind.Object) return;
            foreach (var property in value.EnumerateObject())
            {
                if (property.Name.Equals("goodsId", StringComparison.OrdinalIgnoreCase)
                    && property.Value.ValueKind == JsonValueKind.String)
                    references.Add(property.Value.GetString()!);
                else if (property.Name.Equals("goodsIds", StringComparison.OrdinalIgnoreCase)
                    && property.Value.ValueKind == JsonValueKind.Array)
                {
                    foreach (var entry in property.Value.EnumerateArray())
                        if (entry.ValueKind == JsonValueKind.String) references.Add(entry.GetString()!);
                }
                Visit(property.Value, references);
            }
        }

        private static HashSet<string> ReadReferences(string databasePath, Action<JsonElement, HashSet<string>> visit)
        {
            var references = new HashSet<string>(StringComparer.Ordinal);
            foreach (var name in new[] { "browser-nei-special.json", "browser-quest-items.json" })
            {
                var path = Path.Combine(Path.GetDirectoryName(databasePath) ?? ".", name);
                if (!File.Exists(path)) continue;
                using var document = JsonDocument.Parse(File.ReadAllText(path));
                visit(document.RootElement, references);
            }
            return references;
        }

        private static void VisitOreDictionaries(JsonElement value, HashSet<string> references)
        {
            if (value.ValueKind == JsonValueKind.Array)
            {
                foreach (var child in value.EnumerateArray()) VisitOreDictionaries(child, references);
                return;
            }
            if (value.ValueKind != JsonValueKind.Object) return;
            foreach (var property in value.EnumerateObject())
            {
                if ((property.Name.Equals("oreDictionary", StringComparison.OrdinalIgnoreCase)
                    || property.Name.EndsWith("oreDictionaryId", StringComparison.OrdinalIgnoreCase))
                    && property.Value.ValueKind == JsonValueKind.String)
                    references.Add(property.Value.GetString()!);
                VisitOreDictionaries(property.Value, references);
            }
        }
    }
}
