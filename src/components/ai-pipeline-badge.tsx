function inferPipelineInfo(model: string | null | undefined) {
  if (!model) {
    return null;
  }

  const providers = new Set<string>();

  for (const segment of model.split("|")) {
    const normalized = segment.trim().toLowerCase();

    if (!normalized) {
      continue;
    }

    if (/(gpt|openai)/i.test(normalized)) {
      providers.add("openai");
      continue;
    }

    if (/(claude|anthropic)/i.test(normalized)) {
      providers.add("anthropic");
      continue;
    }

    if (/gemini/i.test(normalized)) {
      providers.add("gemini");
      continue;
    }

    if (/ollama/i.test(normalized)) {
      providers.add("ollama");
    }
  }

  if (providers.size === 0) {
    return null;
  }

  if (providers.size === 1) {
    const provider = [...providers][0];
    return {
      label: "1 MODEL",
      title: provider === "gemini" ? "Gemini-only pipeline" : `${provider}-only pipeline`,
      className: "border-[rgba(63,255,170,0.28)] bg-[rgba(63,255,170,0.10)] text-[#3fffaa]"
    };
  }

  return {
    label: `${providers.size} PIPELINE`,
    title:
      providers.size >= 3
        ? "Legacy 3-model pipeline"
        : `Mixed pipeline (${[...providers].join(" + ")})`,
    className: "border-[rgba(162,89,255,0.28)] bg-[rgba(162,89,255,0.10)] text-[#c87eff]"
  };
}

type AiPipelineBadgeProps = {
  model: string | null | undefined;
  className?: string;
};

export function AiPipelineBadge({ model, className }: AiPipelineBadgeProps) {
  const pipelineInfo = inferPipelineInfo(model);

  if (!pipelineInfo) {
    return null;
  }

  return (
    <span
      title={pipelineInfo.title}
      className={[
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-[1.3px]",
        pipelineInfo.className,
        className ?? ""
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {pipelineInfo.label}
    </span>
  );
}
