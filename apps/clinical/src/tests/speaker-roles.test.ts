import assert from "node:assert/strict";
import test from "node:test";
import {
  groupConsecutiveTurns,
  inferSpeakerRoles,
  orderedSpeakerIds,
  parseDiarizedTurns,
  parseSpeakerRoleMap,
  speakerLabel,
  swapSpeakerRoles,
  type DiarizedTurn,
  type SpeakerRoleMap,
} from "../lib/audio-recording/speaker-roles";

/**
 * Guards the speaker-role inference.
 *
 * The dangerous failure here is not "no answer" — it is a *confident wrong*
 * answer, because it would print the doctor's own questions under the patient's
 * name in a clinical record. The tests therefore care most about the cases that
 * must refuse to decide.
 */

function turns(entries: Array<[string, string]>): DiarizedTurn[] {
  return entries.map(([speakerId, transcript], index) => ({
    speakerId,
    transcript,
    startTimeSeconds: index * 2,
    endTimeSeconds: index * 2 + 1.5,
  }));
}

test("a textbook consultation is attributed correctly and confidently", () => {
  const map = inferSpeakerRoles(
    turns([
      ["0", "What brings you in today?"],
      ["1", "I have pain in my knee for two weeks."],
      ["0", "How long have you had it? Any swelling?"],
      ["1", "I have swelling also since last week."],
      ["0", "Let me examine your knee. Take this tablet twice daily after food."],
      ["1", "Yes doctor. My knee hurts when I climb."],
      ["0", "Do you have any other complaints? Follow up in two weeks."],
      ["1", "No, that is all."],
    ])
  );

  assert.equal(map.roles["0"], "doctor");
  assert.equal(map.roles["1"], "patient");
  assert.equal(map.confidence, "high");
  assert.equal(map.source, "inferred");
  assert.ok(map.reason.length > 0, "an inference must carry its justification");
});

test("a code-mixed Hinglish consultation is still attributed correctly", () => {
  // Marathi and Hindi consultations routinely carry English clinical nouns, so
  // matching a single language would silently lose most of the evidence.
  const map = inferSpeakerRoles(
    turns([
      ["0", "Aapko kya problem hai?"],
      ["1", "Mujhe bukhar aur khansi hai teen din se."],
      ["0", "Kitne din se? Kya aapne koi tablet li?"],
      ["1", "Haan, mera sar dard bhi ho raha hai."],
      ["0", "Theek hai, main aapko medicine likh raha hoon. Roz subah lena."],
      ["1", "Theek hai."],
    ])
  );

  assert.equal(map.roles["0"], "doctor");
  assert.equal(map.roles["1"], "patient");
});

test("an ambiguous conversation refuses to name either side", () => {
  const map = inferSpeakerRoles(
    turns([
      ["0", "Hmm."],
      ["1", "Okay."],
      ["0", "Yes."],
      ["1", "Hmm."],
    ])
  );

  assert.equal(map.roles["0"], "unknown");
  assert.equal(map.roles["1"], "unknown");
  assert.equal(map.confidence, "low");
});

test("a third voice is left unknown rather than forced into a role", () => {
  // An accompanying family member typically speaks very little. Ranking speakers
  // would have picked them as the patient; picking per role instead ignores them.
  const map = inferSpeakerRoles(
    turns([
      ["0", "What brings him in?"],
      ["1", "I have fever for three days."],
      ["2", "I am his son."],
      ["0", "Any other complaints? Let me examine you."],
      ["1", "My body aches also."],
    ])
  );

  assert.equal(map.roles["0"], "doctor");
  assert.equal(map.roles["1"], "patient");
  assert.equal(map.roles["2"], "unknown", "an extra speaker must not be assigned a clinical role");
});

test("swapping records a doctor correction rather than re-guessing", () => {
  const inferred = inferSpeakerRoles(
    turns([
      ["0", "What brings you in?"],
      ["1", "I have fever since last week."],
    ])
  );
  const corrected = swapSpeakerRoles(inferred);

  assert.equal(corrected.roles["0"], "patient");
  assert.equal(corrected.roles["1"], "doctor");
  assert.equal(corrected.source, "doctor_confirmed");
});

test("a single separated speaker never invents a counterpart", () => {
  const map = inferSpeakerRoles(turns([["0", "I have fever and cough since last week."]]));
  assert.equal(map.roles["0"], "patient");
  assert.equal(Object.keys(map.roles).length, 1, "must not fabricate a second speaker");
});

test("grouping merges only adjacent turns from the same speaker", () => {
  const grouped = groupConsecutiveTurns(
    turns([
      ["0", "First part."],
      ["0", "Second part."],
      ["1", "Reply."],
      ["0", "Third part."],
    ])
  );

  assert.equal(grouped.length, 3);
  assert.equal(grouped[0].transcript, "First part. Second part.");
  assert.equal(grouped[1].speakerId, "1");
  assert.equal(grouped[2].transcript, "Third part.");
});

test("speaker ids keep first-appearance order so labels stay stable", () => {
  const ids = orderedSpeakerIds(turns([["1", "a"], ["0", "b"], ["1", "c"]]));
  assert.deepEqual(ids, ["1", "0"]);
  assert.equal(speakerLabel("1", null, ids), "Speaker 1");
  assert.equal(speakerLabel("0", null, ids), "Speaker 2");
});

test("labels prefer the role over the position once roles exist", () => {
  const ids = ["0", "1"];
  const map: SpeakerRoleMap = {
    roles: { "0": "doctor", "1": "patient" },
    confidence: "high",
    reason: "",
    source: "inferred",
  };
  assert.equal(speakerLabel("0", map, ids), "Doctor");
  assert.equal(speakerLabel("1", map, ids), "Patient");
});

test("malformed stored JSONB degrades instead of throwing in a render path", () => {
  assert.deepEqual(parseDiarizedTurns(null), []);
  assert.deepEqual(parseDiarizedTurns({ not: "an array" }), []);
  assert.deepEqual(parseDiarizedTurns([null, 7, { speakerId: "0" }]), []);
  assert.equal(parseDiarizedTurns([{ speakerId: "0", transcript: " hi " }]).length, 1);

  assert.equal(parseSpeakerRoleMap(null), null);
  assert.equal(parseSpeakerRoleMap({ roles: {} }), null);
  assert.deepEqual(parseSpeakerRoleMap({ roles: { "0": "doctor", "1": "bogus" } })?.roles, {
    "0": "doctor",
  });
  // An unconfirmed map must never be silently upgraded to a confirmed one.
  assert.equal(parseSpeakerRoleMap({ roles: { "0": "doctor" } })?.source, "inferred");
});
