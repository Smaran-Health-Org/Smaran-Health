import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { processClaimedMedicalDocument,type ClaimedDocumentProcessing } from "@/lib/documents/process";
import { drainClinicalStateReconciliation } from "@/lib/db/clinical-state";
import { drainPreconsultBriefGeneration } from "@/lib/preconsult/brief";
export async function drainDocumentPipeline(limit=8){const service=createServiceRoleClient();for(let i=0;i<limit;i++){
const {data,error}=await service.rpc("claim_document_processing_work",{p_schema_version:"medical-document-extraction/v1",p_pipeline_version:"browser-qa/v1",p_provider:"synthetic-mock",p_model_version:"synthetic-mock/v1"});
if(error)throw new Error("qa_document_claim_failed");const row=(Array.isArray(data)?data[0]:data) as ClaimedDocumentProcessing|null;if(!row)break;
try{await processClaimedMedicalDocument(row,{provider:"synthetic-mock",modelVersion:"synthetic-mock/v1",process:async()=>({documentType:"lab_report",classificationConfidence:0.99,readabilityConfidence:0.99,isHandwritten:false,isPartiallyUnreadable:false,documentDate:"2026-10-14",documentDateConfidence:0.99,reportIdentifier:"SYNTHETIC-BROWSER-QA",reportIdentifierConfidence:0.99,pages:[{pageNumber:1,text:"Synthetic source evidence only",confidence:0.99}],uncertainItems:[],normalizedObservations:[]})});}
catch{await service.rpc("fail_document_processing_work",{p_work_id:row.work_id,p_extraction_id:row.extraction_id,p_failure_code:"provider_unavailable"});}}
await drainClinicalStateReconciliation();await drainPreconsultBriefGeneration();}
export function wakeDocumentPipeline(){return drainDocumentPipeline().catch(()=>undefined);}
