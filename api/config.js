import { send, withErrors } from "../lib/sarvam.js";

export default withErrors(async (req, res) => {
  send(res, 200, {
    hasKey: Boolean((process.env.SARVAM_API_KEY || "").trim()),
    defaultModel: process.env.PROBE_MODEL || "saaras:v3",
    models: ["saaras:v3", "saaras:v4"],
    modes: ["codemix", "transcribe", "translate", "verbatim", "translit"],
    languages: [
      "unknown",
      "hi-IN",
      "mr-IN",
      "gu-IN",
      "ta-IN",
      "te-IN",
      "kn-IN",
      "bn-IN",
      "pa-IN",
      "ml-IN",
      "od-IN",
      "en-IN",
    ],
    runtime: "vercel",
  });
});
