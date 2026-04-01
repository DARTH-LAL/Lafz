import { createClient } from "@supabase/supabase-js";

const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
const OPENAI_EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL?.trim() || "text-embedding-3-small";
const TARGET_NODE_TYPES = [
  "artist",
  "term_surface",
  "term_sense",
  "motif",
  "symbol",
  "rendering",
  "persona_style",
  "entity_type"
];

function requiredEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }

  return value;
}

function isRecord(value) {
  return typeof value === "object" && value !== null;
}

function asString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asStringArray(value) {
  return Array.isArray(value)
    ? value.map((entry) => asString(entry)).filter(Boolean)
    : [];
}

function normalizeText(value) {
  if (!value) {
    return null;
  }

  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\s+/g, " ");

  return normalized.length > 0 ? normalized : null;
}

function uniqStrings(values) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean)));
}

function buildEmbeddingText(node) {
  const metadata = isRecord(node.metadata) ? node.metadata : {};
  const parts = [
    `type:${node.node_type}`,
    asString(node.display_label),
    ...asStringArray(node.aliases),
    asString(node.description)
  ];

  if (node.node_type === "term_sense") {
    parts.push(asString(metadata.term));
    parts.push(asString(metadata.meaning));
  }

  if (node.node_type === "artist") {
    parts.push(asString(metadata.personaSummary));
  }

  return uniqStrings(parts.map((value) => normalizeText(value))).join(" | ");
}

async function requestEmbeddings(input) {
  const response = await fetch(`${OPENAI_BASE_URL}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requiredEnv("OPENAI_API_KEY")}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: OPENAI_EMBEDDING_MODEL,
      input
    })
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      isRecord(payload) && isRecord(payload.error) && asString(payload.error.message)
        ? payload.error.message
        : `Embedding request failed with status ${response.status}.`;
    throw new Error(message);
  }

  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error("Embedding response had an invalid shape.");
  }

  return payload.data.map((entry, index) => {
    if (!isRecord(entry) || !Array.isArray(entry.embedding)) {
      throw new Error(`Embedding response was missing a vector at index ${index}.`);
    }

    return entry.embedding.filter((value) => typeof value === "number" && Number.isFinite(value));
  });
}

async function fetchNodesMissingEmbeddings(supabase) {
  const nodes = [];

  for (const nodeType of TARGET_NODE_TYPES) {
    let from = 0;
    const batchSize = 200;

    while (true) {
      const { data, error } = await supabase
        .from("kg_nodes")
        .select("id, node_type, display_label, aliases, description, metadata")
        .eq("node_type", nodeType)
        .eq("is_active", true)
        .is("embedding", null)
        .range(from, from + batchSize - 1);

      if (error) {
        throw error;
      }

      if (!data || data.length === 0) {
        break;
      }

      nodes.push(...data);

      if (data.length < batchSize) {
        break;
      }

      from += batchSize;
    }
  }

  return nodes;
}

async function main() {
  const supabase = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  const nodes = await fetchNodesMissingEmbeddings(supabase);
  const candidates = nodes
    .map((node) => ({
      node,
      text: buildEmbeddingText(node)
    }))
    .filter((entry) => entry.text.length > 0);

  let updated = 0;
  let skipped = nodes.length - candidates.length;

  for (let index = 0; index < candidates.length; index += 32) {
    const chunk = candidates.slice(index, index + 32);
    const vectors = await requestEmbeddings(chunk.map((entry) => entry.text));

    for (let innerIndex = 0; innerIndex < chunk.length; innerIndex += 1) {
      const entry = chunk[innerIndex];
      const embedding = vectors[innerIndex];

      if (!Array.isArray(embedding) || embedding.length === 0) {
        skipped += 1;
        continue;
      }

      const { error } = await supabase
        .from("kg_nodes")
        .update({
          embedding,
          updated_at: new Date().toISOString()
        })
        .eq("id", entry.node.id);

      if (error) {
        throw error;
      }

      updated += 1;
    }
  }

  console.log(JSON.stringify({
    model: OPENAI_EMBEDDING_MODEL,
    totalMissing: nodes.length,
    candidateCount: candidates.length,
    updated,
    skipped
  }, null, 2));
}

main().catch((error) => {
  console.error("Brain embedding backfill failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
