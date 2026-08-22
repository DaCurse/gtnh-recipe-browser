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

            var sidecarPath = Path.Combine(
                Path.GetDirectoryName(databasePath) ?? ".",
                "browser-nei-special.json");
            if (!File.Exists(sidecarPath))
                return;

            foreach (var item in items.Values)
                item?.GenerateId();
            foreach (var fluid in fluids.Values)
                fluid.GenerateId();

            using var document = JsonDocument.Parse(File.ReadAllText(sidecarPath));
            var references = new HashSet<string>(StringComparer.Ordinal);
            Visit(document.RootElement, references);
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
            var sidecarPath = Path.Combine(
                Path.GetDirectoryName(databasePath) ?? ".",
                "browser-nei-special.json");
            if (!File.Exists(sidecarPath))
                return;

            using var document = JsonDocument.Parse(File.ReadAllText(sidecarPath));
            var references = new HashSet<string>(StringComparer.Ordinal);
            VisitOreDictionaries(document.RootElement, references);
            foreach (var name in references)
            {
                var group = groups.Values.FirstOrDefault(candidate =>
                    candidate.oreDictNames.Contains(name)
                    || candidate.oreDictNames.Contains("o:" + name)
                    || candidate.oreDictNames.Contains("g:" + name));
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
