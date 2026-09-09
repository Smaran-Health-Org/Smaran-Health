import fs from "node:fs/promises";
import path from "node:path";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const W = 1280;
const H = 720;
const ROOT = "/Users/Neelesh/Documents/Smaran Health";
const TMP = path.join(ROOT, "tmp/presentations/smaran-doctor-vision-2026");
const ASSET = path.join(TMP, "assets");
const RENDER = path.join(TMP, "renders");
const FINAL = path.join(ROOT, "outputs/presentations/smaran-health-doctor-vision.pptx");

const C = {
  ink: "#081A27",
  ink2: "#102A36",
  paper: "#F4F8F5",
  paper2: "#E7F1ED",
  white: "#FFFFFF",
  mint: "#70D5AD",
  mint2: "#CFF2E3",
  teal: "#155D66",
  tealDark: "#0D4F40",
  green: "#17745B",
  blue: "#315FCD",
  blueSoft: "#EAF0FF",
  coral: "#FF8A6B",
  coralSoft: "#FFF1ED",
  amber: "#F3A94C",
  graphite: "#17201E",
  muted: "#66736F",
  muted2: "#8B9793",
  line: "#DDE6E1",
  lineDark: "#24414C",
};

const FONT_HEAD = "Avenir Next";
const FONT_BODY = "Arial";

const assets = {};

async function loadAsset(name) {
  if (!assets[name]) {
    const bytes = await fs.readFile(path.join(ASSET, name));
    assets[name] = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
  return assets[name];
}

function rect(slide, x, y, w, h, fill, opts = {}) {
  return slide.shapes.add({
    geometry: opts.geometry || "roundRect",
    name: opts.name,
    position: { left: x, top: y, width: w, height: h },
    fill,
    line: opts.line || { style: "solid", fill: opts.stroke || fill, width: opts.strokeWidth ?? 0 },
    borderRadius: opts.radius ?? "rounded-xl",
    shadow: opts.shadow,
  });
}

function circle(slide, x, y, d, fill, opts = {}) {
  return slide.shapes.add({
    geometry: "ellipse",
    name: opts.name,
    position: { left: x, top: y, width: d, height: d },
    fill,
    line: opts.line || { style: "solid", fill: opts.stroke || fill, width: opts.strokeWidth ?? 0 },
    shadow: opts.shadow,
  });
}

function line(slide, x, y, w, h, color, width = 2, style = "solid") {
  return slide.shapes.add({
    geometry: "line",
    position: { left: x, top: y, width: w, height: h },
    fill: "none",
    line: { style, fill: color, width },
  });
}

function textBox(slide, text, x, y, w, h, opts = {}) {
  const s = slide.shapes.add({
    geometry: "textbox",
    name: opts.name,
    position: { left: x, top: y, width: w, height: h },
    fill: "none",
    line: { style: "solid", fill: "none", width: 0 },
  });
  s.text = text;
  s.text.style = {
    typeface: opts.typeface || FONT_BODY,
    fontSize: opts.fontSize ?? 22,
    bold: opts.bold ?? false,
    italic: opts.italic ?? false,
    color: opts.color || C.graphite,
    alignment: opts.align || "left",
    verticalAlignment: opts.valign || "top",
    lineSpacing: opts.lineSpacing,
    wrap: opts.wrap || "square",
    autoFit: opts.autoFit || "none",
    insets: opts.insets || { top: 0, right: 0, bottom: 0, left: 0 },
  };
  return s;
}

function addImage(slide, bytes, contentType, alt, x, y, w, h, opts = {}) {
  return slide.images.add({
    blob: bytes,
    contentType,
    alt,
    fit: opts.fit || "cover",
    position: { left: x, top: y, width: w, height: h },
    crop: opts.crop,
    geometry: opts.geometry || "roundRect",
    borderRadius: opts.radius ?? "rounded-xl",
  });
}

function statusChip(slide, label, dark = false, width = 190) {
  const x = W - 72 - width;
  rect(slide, x, 28, width, 30, dark ? C.ink2 : C.white, {
    radius: "rounded-full",
    stroke: dark ? C.lineDark : C.line,
    strokeWidth: 1,
  });
  circle(slide, x + 12, 39, 8, label.includes("HYPOTHESIS") ? C.coral : C.mint);
  textBox(slide, label, x + 28, 34, width - 38, 20, {
    fontSize: 13,
    bold: true,
    color: dark ? C.paper2 : C.tealDark,
    valign: "middle",
  });
}

function smallBrand(slide, dark = false) {
  textBox(slide, "SMARAN HEALTH", 72, 31, 160, 22, {
    fontSize: 14,
    bold: true,
    color: dark ? C.mint2 : C.tealDark,
  });
}

function footer(slide, num, dark = false, note = "Clinical memory for specialist follow-ups") {
  line(slide, 72, 670, 1136, 0, dark ? C.lineDark : C.line, 1);
  textBox(slide, note, 72, 683, 420, 18, {
    fontSize: 12,
    color: dark ? "#9AB1B8" : C.muted2,
  });
  textBox(slide, String(num).padStart(2, "0"), 1158, 682, 50, 18, {
    fontSize: 12,
    bold: true,
    color: dark ? C.mint : C.teal,
    align: "right",
  });
}

function memoryThread(slide, dark = false, coralX = null) {
  line(slide, 72, 650, 1136, 0, dark ? C.teal : C.mint, 2);
  circle(slide, 70, 645, 10, C.mint);
  circle(slide, 1200, 645, 10, dark ? C.mint2 : C.teal);
  if (coralX != null) circle(slide, coralX, 643, 14, C.coral);
}

function title(slide, copy, dark = false, opts = {}) {
  textBox(slide, copy, 72, opts.y ?? 78, opts.w ?? 1080, opts.h ?? 64, {
    typeface: FONT_HEAD,
    fontSize: opts.fontSize ?? 46,
    bold: true,
    color: dark ? C.white : C.ink,
    lineSpacing: 1.02,
    name: opts.name || "slide-title",
  });
}

function kicker(slide, copy, x, y, w, dark = false, color = null) {
  textBox(slide, copy.toUpperCase(), x, y, w, 24, {
    fontSize: 14,
    bold: true,
    color: color || (dark ? C.mint : C.teal),
  });
}

function bullet(slide, copy, x, y, w, opts = {}) {
  circle(slide, x, y + 8, 8, opts.dot || C.mint);
  textBox(slide, copy, x + 20, y, w - 20, opts.h || 54, {
    fontSize: opts.fontSize || 21,
    bold: opts.bold || false,
    color: opts.color || C.graphite,
    lineSpacing: 1.1,
  });
}

function note(slide, presenter, sources) {
  const block = `${presenter}\n\n[Sources]\n${sources.map((s) => `- ${s}`).join("\n")}\n[/Sources]`;
  slide.speakerNotes.textFrame.setText(block);
  slide.speakerNotes.setVisible(true);
}

function addSlide(presentation, background) {
  const slide = presentation.slides.add();
  slide.background.fill = background;
  return slide;
}

async function build() {
  await fs.mkdir(RENDER, { recursive: true });
  await fs.mkdir(path.dirname(FINAL), { recursive: true });

  const coverImg = await loadAsset("cover-doctor-patient-v4-no-portal.png");
  const fragmentsImg = await loadAsset("fragmented-story.png");
  const journeyImg = await loadAsset("patient-journey.png");
  const logoImg = await loadAsset("smaran-mark.png");
  const patientShot = await loadAsset("prototype-patient-profile.png");
  const consentShot = await loadAsset("prototype-consent.png");
  const recordingShot = await loadAsset("prototype-recording.png");
  const reviewShot = await loadAsset("prototype-draft-review.png");

  const deck = Presentation.create({ slideSize: { width: W, height: H } });

  // 1 — Cover
  {
    const s = addSlide(deck, C.ink);
    addImage(s, coverImg, "image/png", "Indian specialist consulting a patient beside a desktop computer, framed by a mint clinical-memory ribbon", 650, 64, 558, 558, { fit: "contain", geometry: "rect", radius: 0 });
    rect(s, 50, 46, 54, 54, C.white, { radius: "rounded-xl", shadow: "shadow-md" });
    addImage(s, logoImg, "image/png", "Smaran Health mark", 59, 55, 36, 36, { fit: "contain", geometry: "rect", radius: 0 });
    kicker(s, "Doctor working session · synthetic data", 72, 135, 460, true, C.mint);
    textBox(s, "Every follow-up\nbegins with the full\npatient story in\nview.", 72, 178, 530, 286, {
      typeface: FONT_HEAD,
      fontSize: 55,
      bold: true,
      color: C.white,
      lineSpacing: 0.98,
      name: "cover-title",
    });
    textBox(s, "Smaran Health · a doctor-led clinical memory vision", 74, 478, 500, 60, {
      fontSize: 24,
      color: C.mint2,
    });
    rect(s, 72, 568, 500, 62, C.ink2, { radius: "rounded-xl", stroke: C.lineDark, strokeWidth: 1, shadow: "shadow-sm" });
    textBox(s, "AI organizes what was documented.\nThe doctor decides what becomes the record.", 92, 581, 460, 42, {
      fontSize: 17,
      bold: true,
      color: C.paper2,
      lineSpacing: 1.05,
    });
    textBox(s, "SMARAN HEALTH · 2026", 72, 680, 260, 18, { fontSize: 12, bold: true, color: C.mint });
    note(s,
      "Open with the desired follow-up experience, not with a feature list. Explain that the deck uses synthetic data and separates current prototype screens from future product directions.",
      [
        `${ROOT}/PROJECT_MEMORY.md — product thesis and doctor-control boundary`,
        `${TMP}/assets/cover-doctor-patient-v4-no-portal.png — generated square editorial visual with the marked cream portal and coral node removed; desktop monitor, keyboard, mouse and mint memory ribbon retained; prompt recorded in source-notes.txt`,
        `${ROOT}/apps/website/public/favicon.svg — Smaran brand mark`,
      ]);
  }

  // 2 — Fragments
  {
    const s = addSlide(deck, C.ink);
    addImage(s, fragmentsImg, "image/png", "Disconnected clinical reports, notes, messages and calendar linked by broken thread", 0, 0, W, H, { geometry: "rect", radius: 0 });
    rect(s, 0, 0, 540, H, C.ink, { geometry: "rect", radius: 0 });
    smallBrand(s, true);
    statusChip(s, "WORKFLOW HYPOTHESIS", true, 206);
    kicker(s, "The follow-up problem", 72, 92, 360, true);
    textBox(s, "The hardest part of follow-up is rebuilding context from fragments.", 72, 126, 450, 220, {
      typeface: FONT_HEAD,
      fontSize: 50,
      bold: true,
      color: C.white,
      lineSpacing: 1.0,
      name: "slide-title",
    });
    textBox(s, "Previous notes, reports, patient recollection, messages, pending tests and medication changes can live in different places.", 72, 372, 430, 122, {
      fontSize: 23,
      color: C.paper2,
      lineSpacing: 1.18,
    });
    textBox(s, "The opportunity is not more data. It is one trustworthy thread.", 72, 535, 430, 68, {
      fontSize: 24,
      bold: true,
      color: C.mint,
    });
    footer(s, 2, true);
    note(s,
      "Treat these as workflow hypotheses to validate with doctors. The visual metaphor is one story dispersed across common clinic artifacts.",
      [
        `${ROOT}/PRODUCT.md — doctor jobs-to-be-done and patient-memory requirements`,
        `${ROOT}/PROJECT_MEMORY.md — longitudinal patient-story thesis`,
        `${TMP}/assets/fragmented-story.png — generated editorial visual; prompt recorded in source-notes.txt`,
      ]);
  }

  // 3 — Memory layer
  {
    const s = addSlide(deck, C.ink);
    smallBrand(s, true);
    statusChip(s, "PRODUCT THESIS", true, 170);
    title(s, "Smaran turns approved encounters into memory", true, { w: 970, h: 100 });
    textBox(s, "A clinical-memory layer—not a diagnostic or prescribing system.", 72, 178, 850, 34, {
      fontSize: 23,
      color: C.paper2,
    });

    const xs = [86, 302, 518, 772, 1000];
    const nodeW = [160, 160, 190, 160, 170];
    for (let i = 0; i < xs.length - 1; i++) {
      line(s, xs[i] + nodeW[i], 322, xs[i + 1] - (xs[i] + nodeW[i]), 0, i === 1 ? C.mint : C.teal, i === 1 ? 5 : 3);
    }
    const labels = [
      ["01", "Consent &\nrecord", "Visible recording or manual path"],
      ["02", "Structured\ndraft", "Evidence, confidence, uncertainty"],
      ["03", "Doctor review\n& approval", "The only gate into clinical truth"],
      ["04", "Approved\ntimeline", "Drafts and rejections stay out"],
      ["05", "Next-visit\nmemory", "What changed and what remains open"],
    ];
    for (let i = 0; i < labels.length; i++) {
      const approval = i === 2;
      rect(s, xs[i], 235, nodeW[i], 184, approval ? C.mint2 : C.ink2, {
        radius: "rounded-2xl",
        stroke: approval ? C.mint : C.lineDark,
        strokeWidth: approval ? 2 : 1,
        shadow: approval ? "shadow-lg" : undefined,
      });
      textBox(s, labels[i][0], xs[i] + 16, 252, 40, 24, { fontSize: 14, bold: true, color: approval ? C.tealDark : C.mint });
      textBox(s, labels[i][1], xs[i] + 16, 286, nodeW[i] - 32, 64, {
        typeface: FONT_HEAD,
        fontSize: 22,
        bold: true,
        color: approval ? C.ink : C.white,
        lineSpacing: 1.0,
      });
      textBox(s, labels[i][2], xs[i] + 16, 362, nodeW[i] - 32, 44, {
        fontSize: 15,
        color: approval ? C.tealDark : "#B6C9CE",
        lineSpacing: 1.05,
      });
    }
    rect(s, 190, 488, 900, 84, C.ink2, { radius: "rounded-2xl", stroke: C.lineDark, strokeWidth: 1 });
    textBox(s, "AI can organize and retrieve. It cannot diagnose, prescribe, alter medication, or finalize a record.", 226, 510, 830, 44, {
      fontSize: 25,
      bold: true,
      color: C.white,
      align: "center",
      valign: "middle",
    });
    memoryThread(s, true);
    footer(s, 3, true);
    note(s,
      "Make the approval gate the center of the explanation. Every downstream memory object comes only from doctor-approved records.",
      [
        `${ROOT}/PROJECT_MEMORY.md — core workflow and safety invariants`,
        `${ROOT}/AGENTS.md — AI pipeline and clinical note state machine`,
        `${ROOT}/PRODUCT.md — AI responsibilities and prohibited actions`,
      ]);
  }

  // 4 — Continuous journey
  {
    const s = addSlide(deck, C.ink);
    addImage(s, journeyImg, "image/png", "Six-stage patient journey linked by a continuous mint memory thread", 0, 0, W, H, { geometry: "rect", radius: 0 });
    rect(s, 0, 0, W, 150, C.ink, { geometry: "rect", radius: 0 });
    smallBrand(s, true);
    statusChip(s, "PRODUCT VISION", true, 170);
    title(s, "The clinic day stays familiar. The record becomes continuous.", true, { y: 73, w: 1040, h: 72, fontSize: 45 });
    const stageLabels = ["Find / onboard", "Consent", "Consult", "Review & approve", "Share approved output", "Return with context"];
    const stageX = [54, 264, 474, 688, 902, 1094];
    for (let i = 0; i < stageLabels.length; i++) {
      textBox(s, stageLabels[i], stageX[i], 626, i === 5 ? 160 : 174, 26, {
        fontSize: 15,
        bold: true,
        color: C.white,
        align: "center",
      });
    }
    textBox(s, "A single thread runs beyond the visit into the next visit.", 370, 675, 540, 20, {
      fontSize: 14,
      bold: true,
      color: C.mint2,
      align: "center",
    });
    note(s,
      "Walk left to right. The patient journey includes patient onboarding, consent, recording, doctor approval, approved sharing, and a context-rich return visit.",
      [
        `${ROOT}/PRODUCT.md — core consultation workflow and future sharing direction`,
        `${ROOT}/PROJECT_MEMORY.md — approved-memory workflow`,
        `${TMP}/assets/patient-journey.png — generated journey visual; prompt recorded in source-notes.txt`,
      ]);
  }

  // 5 — Onboarding
  {
    const s = addSlide(deck, C.paper);
    smallBrand(s, false);
    statusChip(s, "PRODUCT DIRECTION", false, 196);
    title(s, "Onboarding should feel like lookup—not paperwork", false, { w: 450, h: 112, fontSize: 38 });
    textBox(s, "Search first. Create only when needed. Keep identity clinic-scoped and consent scopes separate.", 72, 204, 450, 86, {
      fontSize: 23,
      color: C.muted,
      lineSpacing: 1.16,
    });
    bullet(s, "Minimal demographics and a clear clinic identity", 72, 304, 420, { fontSize: 21 });
    bullet(s, "Language and contact preference visible at the start", 72, 375, 420, { fontSize: 21 });
    bullet(s, "Assistant actions stay permission-based", 72, 446, 420, { fontSize: 21 });
    rect(s, 552, 160, 656, 440, C.white, { radius: "rounded-2xl", stroke: C.line, strokeWidth: 1, shadow: "shadow-lg" });
    kicker(s, "Patient lookup", 590, 190, 300, false);
    textBox(s, "Who is in front of you?", 590, 224, 420, 44, { typeface: FONT_HEAD, fontSize: 32, bold: true, color: C.ink });
    rect(s, 590, 286, 578, 62, C.paper, { radius: "rounded-xl", stroke: C.line, strokeWidth: 1 });
    circle(s, 610, 305, 22, C.mint2, { stroke: C.mint, strokeWidth: 1 });
    line(s, 626, 321, 12, 12, C.teal, 2);
    textBox(s, "Search name · phone · clinic ID", 650, 306, 440, 28, { fontSize: 20, color: C.muted2, valign: "middle" });
    rect(s, 590, 372, 578, 102, C.paper2, { radius: "rounded-xl", stroke: C.mint, strokeWidth: 1 });
    circle(s, 610, 394, 52, C.white, { stroke: C.line, strokeWidth: 1 });
    textBox(s, "AS", 610, 407, 52, 24, { fontSize: 17, bold: true, color: C.tealDark, align: "center", valign: "middle" });
    textBox(s, "Ananya S.\n43 years · Pune · DEMO-PN-1042", 680, 391, 340, 58, { fontSize: 20, bold: true, color: C.graphite, lineSpacing: 1.02 });
    rect(s, 1030, 397, 112, 44, C.green, { radius: "rounded-xl", stroke: C.green, strokeWidth: 1 });
    textBox(s, "Open profile", 1044, 409, 84, 22, { fontSize: 15, bold: true, color: C.white, align: "center", valign: "middle" });
    line(s, 590, 502, 578, 0, C.line, 1);
    textBox(s, "No match? Add a patient with only the fields needed for today’s workflow.", 590, 526, 400, 48, { fontSize: 18, color: C.muted });
    rect(s, 1008, 521, 160, 48, C.white, { radius: "rounded-xl", stroke: C.teal, strokeWidth: 1 });
    textBox(s, "+ New patient", 1029, 534, 118, 22, { fontSize: 16, bold: true, color: C.tealDark, align: "center", valign: "middle" });
    textBox(s, "Illustrative future workflow · synthetic data", 552, 612, 656, 20, { fontSize: 13, color: C.muted2, align: "right" });
    footer(s, 5, false);
    note(s,
      "This is an illustrative future workflow, not a shipped onboarding screen. Emphasize minimal effort and clinic-scoped identity rather than a long registration form.",
      [
        `${ROOT}/PRODUCT.md — patient creation, roles, dashboard and consent requirements`,
        `${ROOT}/AGENTS.md — clinic-scoped access and assistant permissions`,
        `${ROOT}/apps/website/app/prototype/mock-data.ts — synthetic patient Ananya S.`,
      ]);
  }

  // 6 — Consent and recording
  {
    const s = addSlide(deck, C.paper);
    smallBrand(s, false);
    statusChip(s, "SYNTHETIC PROTOTYPE", false, 216);
    title(s, "Recording stays visible, consented, and optional", false, { w: 1050, h: 58, fontSize: 40 });
    textBox(s, "Declining recording does not affect care; a manual note path remains available.", 72, 139, 900, 34, { fontSize: 22, color: C.muted });

    rect(s, 72, 196, 545, 438, C.white, { radius: "rounded-2xl", stroke: C.line, strokeWidth: 1, shadow: "shadow-lg" });
    addImage(s, consentShot, "image/png", "Synthetic prototype consent checkpoint", 84, 208, 521, 338, {
      crop: { left: 0.28, top: 0.08, right: 0.10, bottom: 0.12 },
      radius: "rounded-xl",
    });
    kicker(s, "Separate scopes", 96, 558, 210, false);
    textBox(s, "Recording and clinical processing do not automatically include patient sharing or model improvement.", 96, 580, 490, 44, { fontSize: 16, color: C.graphite });

    rect(s, 663, 196, 545, 438, C.white, { radius: "rounded-2xl", stroke: C.line, strokeWidth: 1, shadow: "shadow-lg" });
    addImage(s, recordingShot, "image/png", "Synthetic prototype live recording screen with pause and stop actions", 675, 208, 521, 338, {
      crop: { left: 0.21, top: 0.13, right: 0.03, bottom: 0.05 },
      radius: "rounded-xl",
    });
    kicker(s, "Visible control", 687, 558, 210, false);
    textBox(s, "The doctor can pause, stop, cancel or continue without recording. Consent stays visible in the workflow.", 687, 580, 490, 44, { fontSize: 16, color: C.graphite });
    footer(s, 6, false);
    note(s,
      "These are current synthetic prototype screens. Point out the separate consent scopes and explicit recording controls. No real patient data is used.",
      [
        `${ROOT}/docs/prototype/task-10-workflow.md — consent and recording state contract`,
        `${ROOT}/docs/prototype/task-14-doctor-test.md — moderated workflow test`,
        `${ROOT}/apps/website/app/prototype/page.tsx — synthetic prototype implementation`,
        `${TMP}/assets/prototype-consent.png and prototype-recording.png — local prototype screenshots`,
      ]);
  }

  // 7 — Draft review
  {
    const s = addSlide(deck, C.paper);
    smallBrand(s, false);
    statusChip(s, "SYNTHETIC PROTOTYPE", false, 216);
    title(s, "AI prepares the draft. The doctor makes the record.", false, { w: 1050, h: 58, fontSize: 40 });
    textBox(s, "Every high-risk field remains editable, evidence-linked and unapproved until the doctor acts.", 72, 139, 950, 34, { fontSize: 22, color: C.muted });

    rect(s, 72, 196, 300, 390, C.ink, { radius: "rounded-2xl", stroke: C.ink, strokeWidth: 1 });
    kicker(s, "Review cockpit", 98, 226, 220, true);
    textBox(s, "Editable fields", 98, 270, 220, 36, { typeface: FONT_HEAD, fontSize: 27, bold: true, color: C.white });
    textBox(s, "The note can be corrected before approval.", 98, 310, 226, 58, { fontSize: 18, color: C.paper2 });
    line(s, 98, 390, 220, 0, C.lineDark, 1);
    textBox(s, "Source evidence", 98, 414, 220, 36, { typeface: FONT_HEAD, fontSize: 27, bold: true, color: C.white });
    textBox(s, "The doctor can inspect the supporting transcript for each field.", 98, 454, 226, 64, { fontSize: 18, color: C.paper2 });
    rect(s, 98, 536, 196, 34, C.coralSoft, { radius: "rounded-full", stroke: C.coral, strokeWidth: 1 });
    textBox(s, "Uncertainty stays visible", 111, 544, 170, 20, { fontSize: 14, bold: true, color: "#9A4937", align: "center" });

    rect(s, 402, 196, 806, 430, C.white, { radius: "rounded-2xl", stroke: C.line, strokeWidth: 1, shadow: "shadow-lg" });
    addImage(s, reviewShot, "image/png", "Synthetic prototype draft-review screen with editable fields and confidence labels", 414, 208, 782, 406, {
      crop: { left: 0.20, top: 0.13, right: 0.02, bottom: 0.05 },
      radius: "rounded-xl",
    });
    textBox(s, "Only explicit approval can add the note to memory.", 402, 635, 806, 24, { fontSize: 17, bold: true, color: C.tealDark, align: "right" });
    footer(s, 7, false);
    note(s,
      "Use this slide to establish doctor control as a product feature. Rejected drafts never enter the patient timeline.",
      [
        `${ROOT}/docs/prototype/task-10-workflow.md — draft review, rejection and approval state contract`,
        `${ROOT}/AGENTS.md — clinical note state machine and AI output validation`,
        `${ROOT}/apps/website/app/prototype/page.tsx — synthetic draft-review implementation`,
        `${TMP}/assets/prototype-draft-review.png — local prototype screenshot`,
      ]);
  }

  // 8 — Patient memory view
  {
    const s = addSlide(deck, C.paper);
    smallBrand(s, false);
    statusChip(s, "SYNTHETIC PROTOTYPE", false, 216);
    title(s, "One patient view holds the whole approved story", false, { w: 1050, h: 58, fontSize: 40 });
    textBox(s, "The next visit starts with approved context—not a reconstruction exercise.", 72, 139, 850, 34, { fontSize: 22, color: C.muted });

    rect(s, 72, 196, 760, 430, C.white, { radius: "rounded-2xl", stroke: C.line, strokeWidth: 1, shadow: "shadow-lg" });
    addImage(s, patientShot, "image/png", "Synthetic patient profile showing approved medication history, pending investigations, advice and timeline", 84, 208, 736, 406, {
      crop: { left: 0.20, top: 0.13, right: 0.03, bottom: 0.01 },
      radius: "rounded-xl",
    });

    kicker(s, "Approved history only", 882, 214, 300, false);
    textBox(s, "Reason for today", 882, 254, 310, 32, { typeface: FONT_HEAD, fontSize: 26, bold: true, color: C.ink });
    textBox(s, "Why the patient is returning, as documented in the record.", 882, 288, 310, 58, { fontSize: 18, color: C.muted });
    textBox(s, "What changed", 882, 366, 310, 32, { typeface: FONT_HEAD, fontSize: 26, bold: true, color: C.ink });
    textBox(s, "Medication changes, investigations reviewed, symptoms and prior advice.", 882, 400, 310, 62, { fontSize: 18, color: C.muted });
    textBox(s, "What remains open", 882, 482, 310, 32, { typeface: FONT_HEAD, fontSize: 26, bold: true, color: C.ink });
    textBox(s, "Pending reports and unresolved items from approved records.", 882, 516, 310, 58, { fontSize: 18, color: C.muted });
    rect(s, 882, 586, 310, 40, C.coralSoft, { radius: "rounded-xl", stroke: C.coral, strokeWidth: 1 });
    textBox(s, "Drafts and rejected notes stay out", 898, 596, 278, 20, { fontSize: 15, bold: true, color: "#8B4638", align: "center" });
    footer(s, 8, false);
    note(s,
      "Explain the memory view in three questions: why is the patient here, what changed, and what remains open? The visible patient is fully synthetic.",
      [
        `${ROOT}/PRODUCT.md — patient profile, timeline and follow-up-memory requirements`,
        `${ROOT}/apps/website/app/prototype/mock-data.ts — synthetic Ananya S. approved history`,
        `${ROOT}/docs/prototype/task-10-workflow.md — approved-history-only rule`,
        `${TMP}/assets/prototype-patient-profile.png — local prototype screenshot`,
      ]);
  }

  // 9 — Reports and trends
  {
    const s = addSlide(deck, C.paper);
    smallBrand(s, false);
    statusChip(s, "PRODUCT DIRECTION", false, 196);
    title(s, "Blood reports can become trends—with source and verification attached", false, { w: 1030, h: 100, fontSize: 43 });
    textBox(s, "Values become easier to review over time. Interpretation remains with the doctor.", 72, 177, 920, 34, { fontSize: 22, color: C.muted });

    rect(s, 72, 232, 730, 370, C.white, { radius: "rounded-2xl", stroke: C.line, strokeWidth: 1, shadow: "shadow-md" });
    kicker(s, "Synthetic trend example", 102, 258, 280, false);
    textBox(s, "HbA1c · last 5 follow-ups", 102, 290, 430, 40, { typeface: FONT_HEAD, fontSize: 30, bold: true, color: C.ink });
    s.charts.add("line", {
      position: { left: 100, top: 336, width: 662, height: 220 },
      categories: ["F/U 1", "F/U 2", "F/U 3", "F/U 4", "F/U 5"],
      series: [{
        name: "HbA1c",
        values: [8.4, 8.1, 7.8, 7.5, 7.1],
        line: { style: "solid", fill: C.blue, width: 4 },
        marker: { symbol: "circle", size: 10 },
      }],
      hasLegend: false,
      chartFill: C.white,
      plotAreaFill: C.white,
      xAxis: {
        textStyle: { fill: C.muted, fontSize: 16 },
        line: { style: "solid", fill: C.line, width: 1 },
        majorGridlines: null,
      },
      yAxis: {
        min: 6.5,
        max: 9,
        majorUnit: 0.5,
        numberFormatCode: "0.0\"%\"",
        textStyle: { fill: C.muted, fontSize: 15 },
        line: { style: "solid", fill: C.line, width: 1 },
        majorGridlines: { style: "solid", fill: C.line, width: 1 },
      },
      dataLabels: {
        showValue: true,
        position: "outEnd",
        textStyle: { fill: C.ink, fontSize: 17, bold: true },
      },
    });
    textBox(s, "Synthetic values · no autonomous interpretation", 102, 566, 650, 22, { fontSize: 14, color: C.muted2 });

    rect(s, 838, 232, 370, 370, C.ink, { radius: "rounded-2xl", stroke: C.ink, strokeWidth: 1 });
    kicker(s, "Provenance lane", 868, 258, 250, true);
    const steps = [
      ["01", "Report accepted", "Date, file and page retained"],
      ["02", "Value extracted", "Shown as unverified"],
      ["03", "Doctor checks", "Units and source confirmed"],
      ["04", "Trend eligible", "Verified value enters the view"],
    ];
    for (let i = 0; i < steps.length; i++) {
      const yy = 300 + i * 68;
      circle(s, 870, yy, 34, i === 3 ? C.mint : C.ink2, { stroke: i === 3 ? C.mint : C.lineDark, strokeWidth: 1 });
      textBox(s, steps[i][0], 870, yy + 8, 34, 18, { fontSize: 13, bold: true, color: i === 3 ? C.ink : C.mint, align: "center", valign: "middle" });
      textBox(s, steps[i][1], 920, yy - 2, 250, 24, { fontSize: 19, bold: true, color: C.white });
      textBox(s, steps[i][2], 920, yy + 24, 250, 25, { fontSize: 14, color: "#B8C9CD" });
      if (i < steps.length - 1) line(s, 887, yy + 34, 0, 34, C.teal, 2);
    }
    textBox(s, "Future concept · not a live lab integration", 838, 612, 370, 20, { fontSize: 13, color: C.muted2, align: "right" });
    footer(s, 9, false);
    note(s,
      "This is a future concept, not a live lab integration. The five-point HbA1c series is illustrative: the sourced synthetic example provides the 8.4% and 7.1% endpoints, while the three intermediate values were added only to demonstrate how the last five follow-ups could be visualized. Dates, units, source and verification should remain attached to every value.",
      [
        `${ROOT}/PRODUCT.md — examination findings, investigation values and future dashboard direction`,
        `${ROOT}/docs/sample-transcripts/SYN-DM-001-improved-hba1c-followup.txt — synthetic 8.4% to 7.1% example`,
        `${ROOT}/PROJECT_MEMORY.md — no inference, provenance and explicit verification requirements`,
      ]);
  }

  // 10 — Pre-visit brief
  {
    const s = addSlide(deck, C.paper);
    smallBrand(s, false);
    statusChip(s, "SYNTHETIC PROTOTYPE", false, 216);
    title(s, "The next visit opens with what changed—and what remains open", false, { w: 1050, h: 100, fontSize: 43 });
    textBox(s, "A concise brief is derived only from approved records.", 72, 177, 850, 34, { fontSize: 22, color: C.muted });

    rect(s, 72, 232, 1136, 382, C.white, { radius: "rounded-2xl", stroke: C.line, strokeWidth: 1, shadow: "shadow-lg" });
    rect(s, 72, 232, 250, 382, C.ink, { radius: "rounded-2xl", stroke: C.ink, strokeWidth: 1 });
    kicker(s, "Pre-visit memory", 98, 264, 200, true);
    textBox(s, "Ananya S.", 98, 304, 200, 44, { typeface: FONT_HEAD, fontSize: 34, bold: true, color: C.white });
    textBox(s, "43 years · Pune\nDiabetes / Endocrinology", 98, 355, 200, 58, { fontSize: 18, color: C.paper2, lineSpacing: 1.05 });
    line(s, 98, 444, 196, 0, C.lineDark, 1);
    textBox(s, "Reason for return", 98, 468, 196, 24, { fontSize: 15, bold: true, color: C.mint });
    textBox(s, "Four-week review of the home sugar log and adherence.", 98, 500, 196, 72, { fontSize: 19, bold: true, color: C.white, lineSpacing: 1.08 });

    kicker(s, "Last approved visit", 360, 264, 220, false);
    textBox(s, "Home fasting readings were documented mostly between 128 and 142. No dizziness or low-sugar symptoms were reported.", 360, 302, 354, 110, { fontSize: 22, color: C.graphite, lineSpacing: 1.16 });
    rect(s, 360, 444, 354, 112, C.paper2, { radius: "rounded-xl", stroke: C.line, strokeWidth: 1 });
    textBox(s, "DOCUMENTED CHANGE", 382, 462, 230, 20, { fontSize: 13, bold: true, color: C.teal });
    textBox(s, "No medication change was explicitly stated in the current consultation.", 382, 492, 310, 62, { fontSize: 17, bold: true, color: C.graphite });

    kicker(s, "Open loops", 760, 264, 200, false, C.coral);
    rect(s, 760, 302, 408, 112, C.coralSoft, { radius: "rounded-xl", stroke: C.coral, strokeWidth: 1 });
    textBox(s, "Pending investigation", 784, 322, 340, 24, { fontSize: 15, bold: true, color: "#9A4937" });
    textBox(s, "HbA1c report remains to be reviewed when available.", 784, 354, 340, 50, { fontSize: 20, bold: true, color: C.graphite });
    rect(s, 760, 444, 408, 112, C.paper, { radius: "rounded-xl", stroke: C.line, strokeWidth: 1 });
    textBox(s, "Unresolved item", 784, 462, 340, 24, { fontSize: 15, bold: true, color: C.teal });
    textBox(s, "The dates of the two missed log entries were not stated.", 784, 494, 340, 50, { fontSize: 20, bold: true, color: C.graphite });
    textBox(s, "✓ Derived only from doctor-approved synthetic records", 360, 578, 808, 22, { fontSize: 14, bold: true, color: C.green, align: "right" });
    footer(s, 10, false);
    note(s,
      "This brief answers three questions before the next consultation: why the patient is returning, what changed, and what remains open. Avoid using AI-generated clinical suggestions.",
      [
        `${ROOT}/apps/website/app/prototype/mock-data.ts — synthetic follow-up memory and transcript`,
        `${ROOT}/docs/prototype/task-10-workflow.md — approved-memory contract`,
        `${ROOT}/PROJECT_MEMORY.md — use unresolved items from approved records`,
      ]);
  }

  // 11 — Approved WhatsApp handoff
  {
    const s = addSlide(deck, C.paper);
    smallBrand(s, false);
    statusChip(s, "PRODUCT DIRECTION", false, 196);
    title(s, "The approved plan should leave the clinic as clearly as it was explained", false, { w: 1050, h: 100, fontSize: 42 });
    textBox(s, "Print and PDF first; secure WhatsApp handoff later—only after approval and separate sharing consent.", 72, 177, 1050, 34, { fontSize: 22, color: C.muted });

    const gateY = 264;
    line(s, 150, gateY + 32, 540, 0, C.mint, 4);
    const gates = [
      [110, "1", "Review content"],
      [330, "2", "Confirm recipient\n+ channel consent"],
      [568, "3", "Deliberate send"],
    ];
    for (const [gx, n, lab] of gates) {
      circle(s, gx, gateY, 64, C.white, { stroke: C.mint, strokeWidth: 3, shadow: "shadow-sm" });
      textBox(s, n, gx, gateY + 16, 64, 32, { typeface: FONT_HEAD, fontSize: 24, bold: true, color: C.tealDark, align: "center", valign: "middle" });
      textBox(s, lab, gx - 40, gateY + 82, 144, 58, { fontSize: 17, bold: true, color: C.graphite, align: "center", lineSpacing: 1.0 });
    }
    rect(s, 90, 432, 600, 154, C.white, { radius: "rounded-2xl", stroke: C.line, strokeWidth: 1 });
    textBox(s, "Share only doctor-approved material", 116, 454, 400, 58, { typeface: FONT_HEAD, fontSize: 26, bold: true, color: C.ink });
    textBox(s, "Patient summary + doctor-authored or explicitly approved prescription copy. Never raw audio or transcript.", 116, 520, 540, 52, { fontSize: 18, color: C.muted, lineSpacing: 1.08 });

    rect(s, 790, 226, 310, 402, C.ink, { radius: "rounded-3xl", stroke: C.ink2, strokeWidth: 3, shadow: "shadow-xl" });
    rect(s, 812, 260, 266, 330, C.paper, { radius: "rounded-2xl", stroke: C.paper, strokeWidth: 0 });
    textBox(s, "Doctor-approved documents", 832, 284, 226, 26, { fontSize: 17, bold: true, color: C.tealDark });
    rect(s, 832, 328, 206, 92, C.white, { radius: "rounded-xl", stroke: C.line, strokeWidth: 1 });
    textBox(s, "SUMMARY.PDF", 850, 346, 170, 18, { fontSize: 13, bold: true, color: C.blue });
    textBox(s, "Visit summary\nPatient instructions", 850, 374, 170, 36, { fontSize: 16, bold: true, color: C.graphite, lineSpacing: 1.0 });
    rect(s, 832, 438, 206, 92, C.white, { radius: "rounded-xl", stroke: C.line, strokeWidth: 1 });
    textBox(s, "PRESCRIPTION COPY", 850, 456, 170, 18, { fontSize: 13, bold: true, color: C.blue });
    textBox(s, "Doctor-authored\nor explicitly approved", 850, 484, 170, 36, { fontSize: 15, bold: true, color: C.graphite, lineSpacing: 1.0 });
    rect(s, 832, 548, 206, 42, C.green, { radius: "rounded-full", stroke: C.green, strokeWidth: 1 });
    textBox(s, "Ready to share", 850, 559, 170, 20, { fontSize: 15, bold: true, color: C.white, align: "center" });
    textBox(s, "Illustrative concept · no automatic sending", 758, 636, 374, 20, { fontSize: 13, color: C.muted2, align: "center" });
    footer(s, 11, false);
    note(s,
      "WhatsApp sharing is a future direction. The channel requires separate consent, a checked recipient and a deliberate send. Smaran must never independently generate or modify a prescription.",
      [
        `${ROOT}/PRODUCT.md — WhatsApp after the first pilot and no automated sharing before approval`,
        `${ROOT}/PROJECT_MEMORY.md — patient-facing sharing requires doctor approval and scoped consent`,
        `${ROOT}/AGENTS.md — no prescribing, prescription modification or unapproved export`,
      ]);
  }

  // 12 — Clinic dashboard
  {
    const s = addSlide(deck, C.paper);
    smallBrand(s, false);
    statusChip(s, "PRODUCT DIRECTION", false, 196);
    title(s, "A calm dashboard can make follow-up work visible", false, { w: 1080, h: 58, fontSize: 40 });
    textBox(s, "Administrative visibility—never clinical risk scoring or treatment recommendation.", 72, 139, 1000, 34, { fontSize: 22, color: C.muted });

    rect(s, 72, 196, 1136, 430, C.white, { radius: "rounded-2xl", stroke: C.line, strokeWidth: 1, shadow: "shadow-lg" });
    rect(s, 72, 196, 210, 430, C.ink, { radius: "rounded-2xl", stroke: C.ink, strokeWidth: 1 });
    kicker(s, "Today", 98, 226, 150, true);
    textBox(s, "Meera’s Clinic", 98, 264, 150, 60, { typeface: FONT_HEAD, fontSize: 29, bold: true, color: C.white });
    textBox(s, "Illustrative synthetic counts", 98, 332, 160, 44, { fontSize: 14, color: "#B6C9CE" });
    const stats = [["4", "Drafts waiting"], ["7", "Follow-ups due"], ["3", "Reports pending"]];
    for (let i = 0; i < stats.length; i++) {
      const yy = 402 + i * 64;
      textBox(s, stats[i][0], 98, yy, 48, 38, { typeface: FONT_HEAD, fontSize: 30, bold: true, color: i === 1 ? C.coral : C.mint });
      textBox(s, stats[i][1], 152, yy + 7, 106, 26, { fontSize: 16, bold: true, color: C.paper2 });
    }

    kicker(s, "Clinic flow", 320, 226, 180, false);
    line(s, 372, 284, 0, 252, C.line, 3);
    const appts = [
      ["09:00", "A.S.", "Follow-up · memory ready"],
      ["09:20", "R.K.", "New patient · onboarding"],
      ["09:40", "M.P.", "Follow-up · report pending"],
      ["10:00", "S.N.", "Draft awaits approval"],
    ];
    for (let i = 0; i < appts.length; i++) {
      const yy = 284 + i * 66;
      circle(s, 363, yy + 2, 20, i === 0 ? C.mint : C.white, { stroke: i === 0 ? C.mint : C.line, strokeWidth: 2 });
      textBox(s, appts[i][0], 320, yy + 1, 40, 20, { fontSize: 14, bold: true, color: C.muted, align: "right" });
      textBox(s, appts[i][1], 402, yy - 3, 52, 24, { fontSize: 18, bold: true, color: C.ink });
      textBox(s, appts[i][2], 458, yy - 3, 286, 24, { fontSize: 17, color: C.muted });
    }

    line(s, 776, 226, 0, 354, C.line, 1);
    kicker(s, "Follow-up continuity", 816, 226, 260, false);
    const followups = [
      ["Due this week", "Doctor-defined return windows", C.mint2],
      ["Overdue", "Appropriate re-engagement queue", C.coralSoft],
      ["Pending report", "Open loop before next review", C.blueSoft],
    ];
    for (let i = 0; i < followups.length; i++) {
      const yy = 282 + i * 92;
      rect(s, 816, yy, 344, 72, followups[i][2], { radius: "rounded-xl", stroke: C.line, strokeWidth: 1 });
      textBox(s, followups[i][0], 838, yy + 14, 180, 22, { fontSize: 18, bold: true, color: C.graphite });
      textBox(s, followups[i][1], 838, yy + 40, 296, 18, { fontSize: 14, color: C.muted });
    }
    textBox(s, "No autonomous alerts · no clinical prioritisation", 816, 572, 344, 20, { fontSize: 14, bold: true, color: C.tealDark, align: "right" });
    footer(s, 12, false);
    note(s,
      "This future dashboard makes administrative work visible: drafts awaiting approval, doctor-defined follow-ups and pending reports. Counts and initials are illustrative synthetic data.",
      [
        `${ROOT}/PRODUCT.md — Today dashboard, missed follow-ups, pending investigations and future clinic metrics`,
        `${ROOT}/AGENTS.md — role permissions, privacy and no autonomous clinical decisions`,
        `${ROOT}/PROJECT_MEMORY.md — dashboard and follow-up effects remain unvalidated directions`,
      ]);
  }

  // 13 — Practice impact hypotheses
  {
    const s = addSlide(deck, C.ink);
    smallBrand(s, true);
    statusChip(s, "PILOT HYPOTHESIS", true, 188);
    title(s, "Continuity may strengthen follow-ups. Practice growth must be measured.", true, { w: 1070, h: 100, fontSize: 43 });
    textBox(s, "Footfall is not the mechanism. Better continuity is the hypothesis.", 72, 177, 900, 34, { fontSize: 22, color: C.paper2 });

    const colX = [72, 348, 624];
    const colW = 244;
    const cards = [
      ["01", "Less documentation\nand retrieval work", "may recover attention and appointment capacity"],
      ["02", "Visible doctor-defined\nfollow-up loops", "may improve completed return visits"],
      ["03", "Clear approved\ntake-home communication", "may strengthen continuity and trust"],
    ];
    for (let i = 0; i < cards.length; i++) {
      rect(s, colX[i], 244, colW, 260, C.ink2, { radius: "rounded-2xl", stroke: C.lineDark, strokeWidth: 1 });
      textBox(s, cards[i][0], colX[i] + 22, 266, 44, 24, { fontSize: 14, bold: true, color: C.mint });
      textBox(s, cards[i][1], colX[i] + 22, 308, colW - 44, 72, { typeface: FONT_HEAD, fontSize: 25, bold: true, color: C.white, lineSpacing: 1.0 });
      line(s, colX[i] + 22, 400, colW - 44, 0, C.lineDark, 1);
      textBox(s, cards[i][2], colX[i] + 22, 424, colW - 44, 58, { fontSize: 18, color: C.paper2, lineSpacing: 1.1 });
    }
    line(s, 884, 372, 66, 0, C.mint, 4);
    rect(s, 950, 244, 258, 260, C.mint2, { radius: "rounded-2xl", stroke: C.mint, strokeWidth: 2, shadow: "shadow-lg" });
    kicker(s, "Measure baseline → pilot", 974, 270, 210, false);
    const measures = ["After-hours documentation", "Consultations per session", "Eligible follow-ups completed", "Appropriate overdue recovery"];
    for (let i = 0; i < measures.length; i++) {
      bullet(s, measures[i], 974, 312 + i * 43, 210, { fontSize: 16, h: 36, dot: i === 2 ? C.coral : C.teal, color: C.graphite });
    }
    rect(s, 72, 548, 1136, 68, C.ink2, { radius: "rounded-xl", stroke: C.lineDark, strokeWidth: 1 });
    textBox(s, "No promise of more footfall. No guaranteed follow-up lift. Compare explicit baselines, denominators and doctor-defined windows.", 98, 568, 1084, 30, { fontSize: 21, bold: true, color: C.white, align: "center", valign: "middle" });
    footer(s, 13, true);
    note(s,
      "Present each causal path as a hypothesis. Smaran is not a lead-generation engine, and the repository contains no evidence of increased footfall or follow-up counts yet.",
      [
        `${ROOT}/PROJECT_MEMORY.md — pilot measurement rules and current maturity`,
        `${ROOT}/PRODUCT.md — doctor jobs, clinic jobs and pilot success metrics`,
        `${ROOT}/ROADMAP.md — controlled-pilot measurement expectations`,
      ]);
  }

  // 14 — Trust gates
  {
    const s = addSlide(deck, C.paper);
    smallBrand(s, false);
    statusChip(s, "SAFETY INVARIANT", false, 184);
    title(s, "Trust is a workflow, not a disclaimer", false, { w: 930 });
    textBox(s, "The patient-memory thread must pass through four non-negotiable gates.", 72, 139, 940, 34, { fontSize: 22, color: C.muted });

    line(s, 130, 338, 1020, 0, C.mint, 6);
    const gates = [
      [116, "01", "Consent", "Version, language, method and scope"],
      [394, "02", "Clinic access", "Every patient record scoped to the clinic"],
      [672, "03", "Provenance", "Evidence and uncertainty stay visible"],
      [950, "04", "Doctor approval", "Only approved content enters memory or sharing"],
    ];
    for (let i = 0; i < gates.length; i++) {
      circle(s, gates[i][0], 296, 84, i === 3 ? C.teal : C.white, { stroke: i === 3 ? C.teal : C.mint, strokeWidth: 4, shadow: "shadow-md" });
      textBox(s, gates[i][1], gates[i][0], 322, 84, 28, { typeface: FONT_HEAD, fontSize: 22, bold: true, color: i === 3 ? C.white : C.tealDark, align: "center", valign: "middle" });
      textBox(s, gates[i][2], gates[i][0] - 58, 400, 200, 34, { typeface: FONT_HEAD, fontSize: 25, bold: true, color: C.ink, align: "center" });
      textBox(s, gates[i][3], gates[i][0] - 64, 444, 212, 66, { fontSize: 17, color: C.muted, align: "center", lineSpacing: 1.1 });
    }
    rect(s, 112, 548, 1056, 72, C.ink, { radius: "rounded-xl", stroke: C.ink, strokeWidth: 1 });
    textBox(s, "Private audio  ·  No clinical content in analytics logs  ·  Immutable approved records with attributable amendments", 138, 571, 1004, 28, { fontSize: 19, bold: true, color: C.white, align: "center", valign: "middle" });
    footer(s, 14, false);
    note(s,
      "The safety model is operational: consent, access control, provenance, explicit approval, private storage, safe analytics and attributable amendments.",
      [
        `${ROOT}/PROJECT_MEMORY.md — safety and privacy invariants`,
        `${ROOT}/AGENTS.md — clinic_id scoping, private audio, no sensitive logs and approval rules`,
        `${ROOT}/PRODUCT.md — doctor control, consent and auditability principles`,
      ]);
  }

  // 15 — Pilot and close
  {
    const s = addSlide(deck, C.ink);
    smallBrand(s, true);
    statusChip(s, "PLANNED PILOT", true, 168);
    title(s, "This future should be earned—doctor by doctor", true, { w: 950, h: 100 });
    textBox(s, "Synthetic workflow → controlled evidence", 72, 185, 520, 28, { fontSize: 20, color: C.paper2 });

    line(s, 118, 248, 0, 284, C.teal, 4);
    const pilotSteps = [
      ["01", "Synthetic walkthrough", "No real patient data"],
      ["02", "Specialist usability review", "Fix blocking safety and comprehension issues"],
      ["03", "Privacy, legal & security gates", "Approve consent, retention and incident gates"],
      ["04", "Controlled consented pilot", "Workflow evidence with explicit measurements"],
    ];
    for (let i = 0; i < pilotSteps.length; i++) {
      const yy = 224 + i * 94;
      circle(s, 94, yy, 48, i === 3 ? C.mint : C.ink2, { stroke: i === 3 ? C.mint : C.teal, strokeWidth: 3 });
      textBox(s, pilotSteps[i][0], 94, yy + 12, 48, 24, { typeface: FONT_HEAD, fontSize: 16, bold: true, color: i === 3 ? C.ink : C.mint, align: "center", valign: "middle" });
      textBox(s, pilotSteps[i][1], 166, yy - 2, 390, 28, { typeface: FONT_HEAD, fontSize: 24, bold: true, color: C.white });
      textBox(s, pilotSteps[i][2], 166, yy + 32, 420, 38, { fontSize: 17, color: "#B6C9CE" });
    }
    rect(s, 72, 596, 520, 52, C.ink2, { radius: "rounded-xl", stroke: C.lineDark, strokeWidth: 1 });
    textBox(s, "Planned scope: 2–5 doctors · 2–3 clinics · 50–150 consented consultations", 90, 611, 484, 24, { fontSize: 16, bold: true, color: C.mint2, align: "center" });

    rect(s, 650, 208, 558, 410, C.white, { radius: "rounded-2xl", stroke: C.white, strokeWidth: 1, shadow: "shadow-xl" });
    kicker(s, "The productive questions", 686, 244, 320, false);
    textBox(s, "What do you need to see first before a follow-up?", 686, 294, 470, 62, { typeface: FONT_HEAD, fontSize: 30, bold: true, color: C.ink, lineSpacing: 1.0 });
    line(s, 686, 378, 470, 0, C.line, 1);
    textBox(s, "What would make reviewing a draft faster and safer?", 686, 402, 470, 62, { typeface: FONT_HEAD, fontSize: 30, bold: true, color: C.ink, lineSpacing: 1.0 });
    line(s, 686, 486, 470, 0, C.line, 1);
    textBox(s, "Which follow-up loop most often breaks today?", 686, 510, 470, 58, { typeface: FONT_HEAD, fontSize: 30, bold: true, color: C.ink, lineSpacing: 1.0 });
    textBox(s, "Workflow evidence—not broad clinical-safety validation.", 686, 580, 470, 22, { fontSize: 15, bold: true, color: C.tealDark, align: "right" });
    textBox(s, "The future is not an AI doctor. It is a doctor who never loses the patient story.", 72, 676, 980, 24, { fontSize: 17, bold: true, color: C.mint2 });
    textBox(s, "15", 1158, 682, 50, 18, { fontSize: 12, bold: true, color: C.mint, align: "right" });
    note(s,
      "Close by asking for doctor input, not by asking for a purchase. The planned pilot scope is a roadmap target and is intended to produce workflow evidence, not broad clinical-safety validation.",
      [
        `${ROOT}/ROADMAP.md — controlled-pilot sequence and proposed scope`,
        `${ROOT}/PROJECT_MEMORY.md — safety gates, current repository maturity and pilot measurement caution`,
        `${ROOT}/docs/prototype/task-14-doctor-test.md — specialist walkthrough questions`,
      ]);
  }

  for (const [index, slide] of deck.slides.items.entries()) {
    const stem = `slide-${String(index + 1).padStart(2, "0")}`;
    const png = await deck.export({ slide, format: "png", scale: 1 });
    await fs.writeFile(path.join(RENDER, `${stem}.png`), new Uint8Array(await png.arrayBuffer()));
    const layout = await slide.export({ format: "layout" });
    await fs.writeFile(path.join(RENDER, `${stem}.layout.json`), await layout.text());
  }

  const montage = await deck.export({ format: "webp", montage: true, scale: 1 });
  await fs.writeFile(path.join(RENDER, "deck-montage.webp"), new Uint8Array(await montage.arrayBuffer()));

  const pptx = await PresentationFile.exportPptx(deck);
  await pptx.save(FINAL);
  console.log(FINAL);
}

build().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
