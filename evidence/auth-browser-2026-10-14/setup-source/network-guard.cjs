const allowed=h=>h==="127.0.0.1"||h==="localhost"||h==="[::1]"||h.endsWith(".localhost");
const baseFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{const u=new URL(typeof input==="string"||input instanceof URL?input:input.url);if(!allowed(u.hostname))throw new Error("qa_external_network_blocked");return baseFetch(input,init);};
for(const moduleName of ["node:http","node:https"]){const m=require(moduleName);for(const name of ["request","get"]){const original=m[name];m[name]=function(input,...rest){let host;if(typeof input==="string"||input instanceof URL)host=new URL(input).hostname;else host=input.hostname||input.host||"localhost";if(!allowed(host))throw new Error("qa_external_network_blocked");return original.call(this,input,...rest);};}}
