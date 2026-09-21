import "server-only";

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { externalProductFactSchema } from "@/schemas/external-product-fact";
import { buildKnowledgeCandidate } from "@/server/domain/knowledge-candidate";

export type KnowledgeCandidateFileWorkflowReport = {
  success: true;
  input_file: string;
  output_file: string;
  candidate_id: string;
  warnings: Array<{ code: string; message: string; fields: string[] }>;
};

export function createKnowledgeCandidateFileWorkflow() {
  return {
    async run(input: {
      inputFilePath: string;
      outputFilePath?: string;
    }): Promise<KnowledgeCandidateFileWorkflowReport> {
      const contents = await readFile(input.inputFilePath, "utf8");
      const fact = externalProductFactSchema.parse(JSON.parse(contents));
      const candidate = buildKnowledgeCandidate(fact, {
        factFileName: path.basename(input.inputFilePath),
      });
      const outputFile = input.outputFilePath
        ?? defaultOutputFile(input.inputFilePath);

      await writeFile(
        outputFile,
        `${JSON.stringify(candidate, null, 2)}\n`,
        "utf8",
      );

      return {
        success: true,
        input_file: input.inputFilePath,
        output_file: outputFile,
        candidate_id: candidate.candidate_id,
        warnings: candidate.warnings,
      };
    },
  };
}

function defaultOutputFile(inputFilePath: string) {
  return inputFilePath.endsWith(".facts.json")
    ? inputFilePath.slice(0, -".facts.json".length) + ".candidate.json"
    : `${inputFilePath}.candidate.json`;
}
