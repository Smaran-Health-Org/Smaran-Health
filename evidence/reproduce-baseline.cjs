const { Client } = require('../apps/clinical/node_modules/pg');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
(async () => {
 const db = new Client({connectionString:'postgresql://postgres:postgres@127.0.0.1:56522/postgres'}); await db.connect();
 await db.query('BEGIN');
 try {
 const a=randomUUID(), b=randomUUID(), actor=randomUUID(), patient=randomUUID(), visit=randomUUID();
 await db.query("INSERT INTO clinics(id,name) VALUES($1,'Synthetic A'),($2,'Synthetic B')",[a,b]);
 await db.query("INSERT INTO profiles(id,clinic_id,email,full_name,role) VALUES($1,$2,'synthetic@example.invalid','Synthetic staff','assistant')",[actor,a]);
 await db.query("INSERT INTO patients(id,clinic_id,full_name) VALUES($1,$2,'Synthetic patient')",[patient,b]);
 await db.query('SET LOCAL ROLE authenticated'); await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[actor]);
 await db.query("UPDATE profiles SET role='doctor' WHERE id=$1",[actor]);
 assert.equal((await db.query('SELECT role FROM profiles WHERE id=$1',[actor])).rows[0].role,'doctor'); console.log('REPRODUCED: existing assistant self-promotes to doctor');
 await db.query('SAVEPOINT clinic_switch');
 try { await db.query('UPDATE profiles SET clinic_id=$1 WHERE id=$2',[b,actor]); console.log('UNEXPECTED: clinic switch permitted'); }
 catch(e) { await db.query('ROLLBACK TO SAVEPOINT clinic_switch'); console.log('NOT REPRODUCED: clinic switch rejected by RLS (SQLSTATE '+e.code+')'); }
 assert.equal((await db.query('SELECT count(*)::int n FROM patients WHERE id=$1',[patient])).rows[0].n,0);
 await db.query('RELEASE SAVEPOINT clinic_switch');
 await db.query('RESET ROLE');
 await db.query('UPDATE profiles SET clinic_id=$1 WHERE id=$2',[b,actor]);
 await db.query('INSERT INTO consultations(id,clinic_id,patient_id,doctor_id) VALUES($1,$2,$3,$4)',[visit,b,patient,actor]);
 const content = text => JSON.stringify({summary:text});
 // Same SQL sequence as the baseline helper: pre-provider read sees no note,
 // manual save inserts a note, late generator re-reads and updates that row.
 assert.equal((await db.query('SELECT id FROM clinical_notes WHERE consultation_id=$1',[visit])).rowCount,0);
 await db.query("INSERT INTO clinical_notes(consultation_id,clinic_id,doctor_id,status,content) VALUES($1,$2,$3,'edited',$4)",[visit,b,actor,content('Human edit')]);
 const note=(await db.query('SELECT id FROM clinical_notes WHERE consultation_id=$1',[visit])).rows[0].id;
 await db.query("UPDATE clinical_notes SET content=$1,status='ai_draft',approved_at=NULL,approved_by=NULL WHERE id=$2",[content('Late AI'),note]);
 assert.equal((await db.query('SELECT content->>\'summary\' s FROM clinical_notes WHERE id=$1',[note])).rows[0].s,'Late AI'); console.log('REPRODUCED: late AI overwrites human edit');
 await db.query("INSERT INTO clinical_notes(consultation_id,clinic_id,doctor_id,content) VALUES($1,$2,$3,$4)",[visit,b,actor,content('Second generator')]);
 assert.equal((await db.query('SELECT count(*)::int n FROM clinical_notes WHERE consultation_id=$1',[visit])).rows[0].n,2); console.log('REPRODUCED: two generators can insert two notes');
 await db.query("UPDATE clinical_notes SET status='approved',approved_at=now(),approved_by=$1 WHERE id=$2",[actor,note]);
 for(let i=0;i<2;i++) await db.query("INSERT INTO patient_timeline_events(patient_id,clinic_id,consultation_id,clinical_note_id,event_type,summary) VALUES($1,$2,$3,$4,'follow_up','Synthetic approval')",[patient,b,visit,note]);
 assert.equal((await db.query('SELECT count(*)::int n FROM patient_timeline_events WHERE clinical_note_id=$1',[note])).rows[0].n,2); console.log('REPRODUCED: approval replay duplicates timeline');
 assert.equal((await db.query('SELECT status FROM consultations WHERE id=$1',[visit])).rows[0].status,'draft'); console.log('REPRODUCED: separate saves leave approved note with draft consultation if later write fails');
 await db.query("UPDATE clinical_notes SET status='edited',content=$1,approved_at=NULL,approved_by=NULL WHERE id=$2",[content('Overwritten approved record'),note]);
 console.log('REPRODUCED: ordinary save mutates approved record');
 } finally {await db.query('ROLLBACK'); await db.end();}
})().catch(e=>{console.error(e.message); process.exitCode=1});
