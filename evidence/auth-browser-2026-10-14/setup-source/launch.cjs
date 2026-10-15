const fs=require("node:fs");const path=require("node:path");const {spawn}=require("node:child_process");
const status=JSON.parse(fs.readFileSync(path.join(__dirname,"../../auth-status.raw.json"),"utf8"));
if(status.API_URL!=="http://127.0.0.1:56521")throw new Error("Unexpected task API");
const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,LANG:process.env.LANG,NODE_ENV:"development",NEXT_TELEMETRY_DISABLED:"1",NODE_OPTIONS:"--require "+path.join(__dirname,"network-guard.cjs"),NEXT_PUBLIC_SUPABASE_URL:status.API_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY:status.ANON_KEY,SUPABASE_SERVICE_ROLE_KEY:status.SERVICE_ROLE_KEY,NEXT_PUBLIC_APP_URL:"http://smaran-auth-qa.localhost:56731",INTAKE_DELIVERY_MODE:"preview",DEBUG_LOG_DISABLED:"1",DEBUG_AUTH_TRACE:"false"};
const child=spawn(process.execPath,[require.resolve("next/dist/bin/next"),"dev","--webpack","--hostname","127.0.0.1","--port","56731"],{cwd:path.join(__dirname,".."),env,stdio:"inherit"});
for(const signal of ["SIGINT","SIGTERM"])process.on(signal,()=>child.kill(signal));child.on("exit",code=>process.exit(code||0));
