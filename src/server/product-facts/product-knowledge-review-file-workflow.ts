import "server-only";

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { externalProductFactSchema } from "@/schemas/external-product-fact";
import { knowledgeCandidateSchema } from "@/schemas/knowledge-candidate";
import { productKnowledgeReviewSchema } from "@/schemas/product-knowledge-review";
import {
  compileProductKnowledgeSeed,
  createProductKnowledgeReview,
  validateProductKnowledgeReview,
} from "@/server/domain/product-knowledge-review";

const PRODUCT_KEY_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export type ProductKnowledgeReviewPrepareReport = {
  action: "prepare";
  success: true;
  candidate_file: string;
  review_file: string;
  candidate_id: string;
  approved: false;
};

export type ProductKnowledgeReviewValidateReport = {
  action: "validate";
  success: boolean;
  candidate_file: string;
  review_file: string;
  candidate_id: string;
  errors: Array<{ code: string; message: string; path: Array<string | number> }>;
  warnings: Array<{ code: string; message: string; path: Array<string | number> }>;
};

export type ProductKnowledgeReviewCompileReport = {
  action: "compile";
  success: true;
  candidate_file: string;
  review_file: string;
  fact_file: string;
  identity_file: string;
  knowledge_file: string;
  catalog_product_id: string;
  capabilities_compiled: 0;
};

export function createProductKnowledgeReviewFileWorkflow() {
  return {
    async prepare(input: {
      candidateFilePath: string;
      reviewFilePath?: string;
    }): Promise<ProductKnowledgeReviewPrepareReport> {
      const candidate = await readCandidate(input.candidateFilePath);
      const review = createProductKnowledgeReview(candidate);
      const reviewFile = input.reviewFilePath
        ?? defaultReviewFile(input.candidateFilePath);

      // Human review is durable work. Never overwrite an existing manifest.
      await writeJsonExclusive(reviewFile, review);
      return {
        action: "prepare",
        success: true,
        candidate_file: input.candidateFilePath,
        review_file: reviewFile,
        candidate_id: candidate.candidate_id,
        approved: false,
      };
    },

    async validate(input: {
      candidateFilePath: string;
      reviewFilePath: string;
    }): Promise<ProductKnowledgeReviewValidateReport> {
      const candidate = await readCandidate(input.candidateFilePath);
      const review = await readReview(input.reviewFilePath);
      const result = validateProductKnowledgeReview(candidate, review);
      return {
        action: "validate",
        success: result.valid,
        candidate_file: input.candidateFilePath,
        review_file: input.reviewFilePath,
        candidate_id: candidate.candidate_id,
        errors: result.errors,
        warnings: result.warnings,
      };
    },

    async compile(input: {
      candidateFilePath: string;
      reviewFilePath: string;
      outputDirectory?: string;
      productKey?: string;
    }): Promise<ProductKnowledgeReviewCompileReport> {
      const candidate = await readCandidate(input.candidateFilePath);
      const review = await readReview(input.reviewFilePath);
      if (path.basename(candidate.input_fact.file_name)
          !== candidate.input_fact.file_name) {
        throw new Error("Candidate 的 input_fact.file_name 必须是同目录文件名。");
      }
      const factFile = path.resolve(
        path.dirname(input.candidateFilePath),
        candidate.input_fact.file_name,
      );
      const fact = externalProductFactSchema.parse(
        JSON.parse(await readFile(factFile, "utf8")),
      );
      const compiled = compileProductKnowledgeSeed({ candidate, review, fact });
      const productKey = input.productKey
        ?? defaultProductKey(input.candidateFilePath);
      if (!PRODUCT_KEY_PATTERN.test(productKey)) {
        throw new Error(
          "product-key 只允许小写字母、数字和连字符，且必须以字母或数字开头。",
        );
      }
      const outputDirectory = input.outputDirectory
        ?? path.resolve("knowledge-data/product-seed");
      const identityFile = path.join(
        outputDirectory,
        `${productKey}.identity.json`,
      );
      const knowledgeFile = path.join(
        outputDirectory,
        `${productKey}.knowledge.json`,
      );

      await mkdir(outputDirectory, { recursive: true });
      await assertDoesNotExist(identityFile);
      await assertDoesNotExist(knowledgeFile);
      await writeJsonExclusive(identityFile, compiled.identitySeed);
      await writeJsonExclusive(knowledgeFile, compiled.knowledgeSeed);

      return {
        action: "compile",
        success: true,
        candidate_file: input.candidateFilePath,
        review_file: input.reviewFilePath,
        fact_file: factFile,
        identity_file: identityFile,
        knowledge_file: knowledgeFile,
        catalog_product_id: compiled.identitySeed.catalog_product_id,
        capabilities_compiled: 0,
      };
    },
  };
}

async function readCandidate(filePath: string) {
  return knowledgeCandidateSchema.parse(
    JSON.parse(await readFile(filePath, "utf8")),
  );
}

async function readReview(filePath: string) {
  return productKnowledgeReviewSchema.parse(
    JSON.parse(await readFile(filePath, "utf8")),
  );
}

async function writeJsonExclusive(filePath: string, value: unknown) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

async function assertDoesNotExist(filePath: string) {
  try {
    await access(filePath);
  } catch {
    return;
  }
  throw new Error(`拒绝覆盖已有文件：${filePath}`);
}

function defaultReviewFile(candidateFilePath: string) {
  return candidateFilePath.endsWith(".candidate.json")
    ? candidateFilePath.slice(0, -".candidate.json".length) + ".review.json"
    : `${candidateFilePath}.review.json`;
}

function defaultProductKey(candidateFilePath: string) {
  const fileName = path.basename(candidateFilePath);
  return fileName.endsWith(".candidate.json")
    ? fileName.slice(0, -".candidate.json".length)
    : fileName;
}
