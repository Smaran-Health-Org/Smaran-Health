import type { NextConfig } from "next";
import path from "node:path";
const config:NextConfig={allowedDevOrigins:["smaran-auth-qa.localhost"],experimental:{staleTimes:{dynamic:30,static:180}},webpack(config){config.resolve.alias["@/lib/documents/pipeline"]=path.join(process.cwd(),"qa/document-only-pipeline.ts");return config;}};
export default config;
