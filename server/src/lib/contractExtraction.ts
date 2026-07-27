import Anthropic from "@anthropic-ai/sdk";
import { PDFParse } from "pdf-parse";
import type { ChecklistItem, ProjectType } from "@prisma/client";

const MAX_CONTRACT_CHARS = 20000;

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text.trim();
  } finally {
    await parser.destroy();
  }
}

export interface ExtractedProjectDetails {
  name: string | null;
  description: string | null;
  teamSupportTicketNumber: string | null;
  projectTypeId: string | null;
  checklistItemIds: string[];
  notes: string | null;
}

interface RawExtraction {
  name: string;
  description: string;
  teamSupportTicketNumber: string;
  projectTypeName: string;
  productNames: string[];
  notes: string;
}

const EXTRACTION_TOOL: Anthropic.Tool = {
  name: "extracted_project_details",
  description: "Structured project setup details extracted from a customer contract.",
  input_schema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description:
          'Suggested project name following the pattern "Customer Name — Engagement Description". Empty string if you can\'t determine one.',
      },
      description: {
        type: "string",
        description: "A 1-2 sentence plain-English summary of the engagement scope. Empty string if there isn't enough information.",
      },
      teamSupportTicketNumber: {
        type: "string",
        description:
          "The TeamSupport ticket number, only if explicitly written in the contract text. Empty string otherwise — never invent one.",
      },
      projectTypeName: {
        type: "string",
        description:
          "The single best-matching name from the provided project type list, exactly as given. Empty string if none reasonably fit.",
      },
      productNames: {
        type: "array",
        items: { type: "string" },
        description:
          "Every name from the provided product list, exactly as given, that this contract's scope includes. Empty array if none clearly apply.",
      },
      notes: {
        type: "string",
        description:
          "Anything worth double-checking before creating the project — an uncertain match, missing info, or ambiguity. Empty string if nothing stands out.",
      },
    },
    required: ["name", "description", "teamSupportTicketNumber", "projectTypeName", "productNames", "notes"],
  },
};

function nullIfEmpty(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildPrompt(contractText: string, projectTypes: ProjectType[], products: ChecklistItem[]): string {
  const truncated =
    contractText.length > MAX_CONTRACT_CHARS ? `${contractText.slice(0, MAX_CONTRACT_CHARS)}\n...[truncated]` : contractText;

  return `You are helping an implementation team at Harris Computer set up a new project in Aurora, their project management tool, from a signed customer contract.

Existing project types in this software line (pick the single best match, or none):
${projectTypes.map((t) => `- ${t.name}`).join("\n") || "(none configured yet)"}

Existing products/modules catalog (pick every one that applies, or none):
${products.map((p) => `- ${p.name}`).join("\n") || "(none configured yet)"}

Project names in this app typically follow the pattern "Customer Name — Engagement Description", for example "Lakeview Township — Payroll Go-Live" or "Millbrook County — Utility Billing".

Read the contract text below and extract the project details using the extracted_project_details tool. Only choose a project type name and product names that are an exact match to the lists above — never invent new ones. Only fill in a TeamSupport ticket number if one is explicitly written in the text.

Contract text:
"""
${truncated}
"""`;
}

// Claude only sees the catalog *names*, since that's what it can reason about from contract
// text — the actual ids never leave this server. Matching back to real ids (and dropping
// anything that doesn't exactly match) happens here, so a hallucinated name can never end up
// as a phantom projectTypeId/checklistItemId sent to the client.
export async function extractProjectDetailsFromContract(
  contractText: string,
  projectTypes: ProjectType[],
  products: ChecklistItem[]
): Promise<ExtractedProjectDetails> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const client = new Anthropic({ apiKey, timeout: 45_000 });
  const message = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1500,
    tools: [EXTRACTION_TOOL],
    tool_choice: { type: "tool", name: "extracted_project_details" },
    messages: [{ role: "user", content: buildPrompt(contractText, projectTypes, products) }],
  });

  const toolUse = message.content.find((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
  if (!toolUse) {
    throw new Error("Claude did not return structured extraction output");
  }
  const raw = toolUse.input as RawExtraction;

  const matchedType = nullIfEmpty(raw.projectTypeName)
    ? projectTypes.find((t) => t.name.toLowerCase() === raw.projectTypeName.trim().toLowerCase())
    : undefined;
  const matchedProductIds = products
    .filter((p) => raw.productNames.some((name) => name.trim().toLowerCase() === p.name.toLowerCase()))
    .map((p) => p.id);

  const notesParts: string[] = [];
  const rawNotes = nullIfEmpty(raw.notes);
  if (rawNotes) notesParts.push(rawNotes);
  if (nullIfEmpty(raw.projectTypeName) && !matchedType) {
    notesParts.push(`Claude suggested a project type ("${raw.projectTypeName.trim()}") that isn't in your catalog — pick one manually.`);
  }

  return {
    name: nullIfEmpty(raw.name),
    description: nullIfEmpty(raw.description),
    teamSupportTicketNumber: nullIfEmpty(raw.teamSupportTicketNumber),
    projectTypeId: matchedType?.id ?? null,
    checklistItemIds: matchedProductIds,
    notes: notesParts.length > 0 ? notesParts.join(" ") : null,
  };
}
