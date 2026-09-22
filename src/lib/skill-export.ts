/**
 * Utilities for formatting and exporting skills as standard Markdown (.md) documents.
 */

export function formatSkillAsMarkdown(skill: {
  name?: string;
  label?: string;
  description?: string;
  instructions?: string;
}): string {
  const slug =
    skill.name ||
    String(skill.label || "skill")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);

  const label = skill.label || slug;
  const desc = (skill.description || "").replace(/"/g, '\\"');

  return [
    "---",
    `name: ${slug}`,
    `label: "${label.replace(/"/g, '\\"')}"`,
    `description: "${desc}"`,
    "---",
    "",
    `# ${label}`,
    "",
    skill.instructions || "",
  ].join("\n");
}

export function downloadSkillMarkdown(skill: {
  name?: string;
  label?: string;
  description?: string;
  instructions?: string;
}) {
  if (typeof window === "undefined") return;
  const content = formatSkillAsMarkdown(skill);
  const slug =
    skill.name ||
    String(skill.label || "skill")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);

  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slug || "skill"}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
