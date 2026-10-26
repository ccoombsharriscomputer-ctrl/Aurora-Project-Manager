import Anthropic from "@anthropic-ai/sdk";
import { PDFParse } from "pdf-parse";
import type { ChecklistItem, ProjectType } from "@prisma/client";
import { CONTRACT_CATEGORIES, defaultLineHours, isContractCategory } from "./contractCategories";

// Claude reads PDFs up to 100 pages.
export const MAX_CONTRACT_PAGES = 100;

// Opens the PDF just far enough to confirm it's a real one and count its pages (throws if it's
// corrupted). The contract itself goes to Claude as the PDF, not as extracted text, so scanned
// pages and tables that are really pictures get read too.
export async function countPdfPages(buffer: Buffer): Promise<number> {
  const parser = new PDFParse({ data: buffer });
  try {
    const info = await parser.getInfo();
    return info.total;
  } finally {
    await parser.destroy();
  }
}

export interface ExtractedContractLine {
  category: string;
  description: string;
  checklistItemId: string | null;
  hours: number | null;
  amount: number | null;
}

export interface ExtractedProjectDetails {
  name: string | null;
  description: string | null;
  teamSupportTicketNumber: string | null;
  projectTypeId: string | null;
  checklistItemIds: string[];
  contractLines: ExtractedContractLine[];
  notes: string | null;
}

interface RawExtraction {
  name: string;
  description: string;
  teamSupportTicketNumber: string;
  projectTypeName: string;
  productNames: string[];
  contractLines?: {
    productName: string;
    category: string;
    description: string;
    hours: number;
    amount: number;
  }[];
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
      contractLines: {
        type: "array",
        description:
          "One entry per billable SERVICES line in the contract's pricing table (training, installation, project management, data conversion, go-live...). Skip license, maintenance and subscription lines, and skip any line that is $0 or marked no charge.",
        items: {
          type: "object",
          properties: {
            productName: {
              type: "string",
              description:
                "The name from the provided product list, exactly as given, that this line belongs to (e.g. the line 'Budgetary Training - 10 Hours' belongs to the product 'Budgetary'). Empty string if none fits.",
            },
            category: {
              type: "string",
              enum: [...CONTRACT_CATEGORIES],
              description:
                "The kind of service. Any line described as a combination of installation, implementation, setup, configuration and/or PM (e.g. 'Budgetary Installation, Implementation, Setup, Config, PM') is 'Project Management'. A line for installing and configuring software on its own is 'Installation'. Any line labeled conversion (e.g. 'Conversion - Chart of Accounts') is 'Data Conversion'.",
            },
            description: { type: "string", description: "The line's description from the contract, as written." },
            hours: {
              type: "number",
              description:
                "Hours sold: from the description (e.g. 'Training - 10 Hours' is 10) or, for an hourly line, the quantity. 0 if the contract doesn't say.",
            },
            amount: {
              type: "number",
              description: "The line's total price in dollars (quantity times unit price), as a plain number.",
            },
          },
          required: ["productName", "category", "description", "hours", "amount"],
        },
      },
      notes: {
        type: "string",
        description:
          "Anything worth double-checking before creating the project — an uncertain match, missing info, or ambiguity. Empty string if nothing stands out.",
      },
    },
    required: ["name", "description", "teamSupportTicketNumber", "projectTypeName", "productNames", "contractLines", "notes"],
  },
};

function nullIfEmpty(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildPrompt(projectTypes: ProjectType[], products: ChecklistItem[]): string {
  return `You are helping an implementation team at Harris Computer set up a new project in Aurora, their project management tool, from a signed customer contract.

Existing project types in this software line (pick the single best match, or none):
${projectTypes.map((t) => `- ${t.name}`).join("\n") || "(none configured yet)"}

Existing products/modules catalog (pick every one that applies, or none):
${products.map((p) => `- ${p.name}`).join("\n") || "(none configured yet)"}

Project names in this app typically follow the pattern "Customer Name — Engagement Description", for example "Lakeview Township — Payroll Go-Live" or "Millbrook County — Utility Billing".

Read the attached contract (a PDF that may include scanned pages) and extract the project details using the extracted_project_details tool. Only choose a project type name and product names that are an exact match to the lists above — never invent new ones. Only fill in a TeamSupport ticket number if one is explicitly written in the contract.

Also list the contract's billable services lines in contractLines — read them from the pricing table. Only services count: leave out license, maintenance and subscription lines, and any line priced at $0 or marked no charge.`;
}

// Claude only sees the catalog *names*, since that's what it can reason about from contract
// text — the actual ids never leave this server. Matching back to real ids (and dropping
// anything that doesn't exactly match) happens here, so a hallucinated name can never end up
// as a phantom projectTypeId/checklistItemId sent to the client.
export async function extractProjectDetailsFromContract(
  pdf: Buffer,
  projectTypes: ProjectType[],
  products: ChecklistItem[]
): Promise<ExtractedProjectDetails> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const client = new Anthropic({ apiKey, timeout: 90_000 });
  const message = await client.messages.create({
    model: process.env.CONTRACT_MODEL || "claude-sonnet-5",
    max_tokens: 4000,
    tools: [EXTRACTION_TOOL],
    tool_choice: { type: "tool", name: "extracted_project_details" },
    messages: [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf.toString("base64") } },
          { type: "text", text: buildPrompt(projectTypes, products) },
        ],
      },
    ],
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

  const contractLines: ExtractedContractLine[] = (raw.contractLines ?? [])
    .filter((line) => Number(line.amount) > 0)
    .map((line) => {
      const product = nullIfEmpty(line.productName)
        ? products.find((p) => p.name.toLowerCase() === line.productName.trim().toLowerCase())
        : undefined;
      const category = isContractCategory(line.category) ? line.category : "Other";
      const amount = Math.round(Number(line.amount) * 100) / 100;
      return {
        category,
        description: line.description.trim(),
        checklistItemId: product?.id ?? null,
        // A conversion line with no stated hours is worked out from its amount (see defaultLineHours).
        hours: defaultLineHours(category, Number(line.hours), amount),
        amount,
      };
    });

  return {
    name: nullIfEmpty(raw.name),
    description: nullIfEmpty(raw.description),
    teamSupportTicketNumber: nullIfEmpty(raw.teamSupportTicketNumber),
    projectTypeId: matchedType?.id ?? null,
    checklistItemIds: matchedProductIds,
    contractLines,
    notes: notesParts.length > 0 ? notesParts.join(" ") : null,
  };
}
