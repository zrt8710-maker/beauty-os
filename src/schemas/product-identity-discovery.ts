import { z } from "zod";
import { recognitionObservedTextSchema } from "@/schemas/product-recognition";
import { productSearchResultSchema } from "@/schemas/product-search";

const nullable = (max: number) => z.string().trim().min(1).max(max).nullable();
export const productIdentityDiscoveryInputSchema = z.object({
  source: z.enum(["manual_search", "image_recognition"]), raw_query: z.string().trim().min(1).max(1000).nullable(),
  brand_hint: nullable(120), product_name_hint: nullable(200), barcode_hint: nullable(32),
  observed_text: z.array(recognitionObservedTextSchema).max(30), recognition_confidence: z.number().int().min(0).max(100).nullable(),
  // Application-controlled SearchInfinity leads. They are candidate evidence,
  // not verified product facts and never create Catalog rows by themselves.
  search_results: z.array(productSearchResultSchema).max(10).default([]),
}).strict();
export const productIdentityCandidateSchema = z.object({
  candidate_id: z.string().trim().min(1).max(200), brand_name: z.string().trim().min(1).max(120), product_name: z.string().trim().min(1).max(200),
  aliases: z.array(z.string().trim().min(1).max(200)).max(20), variant_name: nullable(200), barcode: nullable(32), image_url: z.url().nullable(), short_descriptor: nullable(300), confidence: z.number().int().min(0).max(100),
  sources: z.array(z.object({ url: z.url().max(2000), title: nullable(500), source_type: nullable(80) }).strict()).min(1).max(10), uncertainties: z.array(z.string().trim().min(1).max(1000)).max(20),
}).strict();
export const productIdentityDiscoveryResultSchema = z.object({ status: z.enum(["found","ambiguous","unresolved","unavailable"]), candidates: z.array(productIdentityCandidateSchema).max(3), research_run_id: nullable(200) }).strict().superRefine((v,c)=>{ if((v.status==="found"||v.status==="ambiguous")&&v.candidates.length===0)c.addIssue({code:"custom",message:"candidate status requires candidates",path:["candidates"]}); if((v.status==="unresolved"||v.status==="unavailable")&&v.candidates.length>0)c.addIssue({code:"custom",message:"non-candidate status forbids candidates",path:["candidates"]}); });
export type ProductIdentityDiscoveryInput=z.infer<typeof productIdentityDiscoveryInputSchema>; export type ProductIdentityDiscoveryResult=z.infer<typeof productIdentityDiscoveryResultSchema>;
