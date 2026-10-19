import { AppShell } from "@/components/app-shell";
import { ClinicDeskToday } from "@/components/clinic-desk-today";
import { DoctorTodayList } from "@/components/doctor-today-list";
import { getSessionContext } from "@/lib/db/session";
import { redirect } from "next/navigation";
import type { AppointmentQueueItem, AppointmentQueue } from "@/lib/db/appointment-queue";
import styles from "@/components/clinical.module.css";
export default async function ResponsiveFixture({ searchParams }: { searchParams: Promise<{ count?: string; mode?: string; stress?: string }> }) {
 const session = await getSessionContext(); if (!session || session.role !== "doctor") redirect("/login");
 const params = await searchParams; const count = params.count === "0" ? 0 : params.count === "1" ? 1 : 20;
 const doctor = params.mode === "doctor"; const perStage = params.stress === "stages"; const total = perStage ? count*4 : count;
 const items: AppointmentQueueItem[] = Array.from({length: total}, (_, i) => ({
  appointmentId: `00000000-0000-4000-8000-${String(i+1).padStart(12,"0")}`, consultationId: `00000000-0000-4000-8001-${String(i+1).padStart(12,"0")}`, patientId: `00000000-0000-4000-8002-${String(i+1).padStart(12,"0")}`,
  patientName: i === 0 ? "SyntheticLongUnbrokenPatientIdentityForResponsiveContainmentABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" : `Synthetic patient ${i+1} with a deliberately long fictional family name for wrapping`,
  scheduledAt: "2026-10-14T04:30:00Z", checkedInAt: "2026-10-14T04:30:00Z", queueOrder: i+1,
  appointmentStatus: perStage && i%4===3 ? "completed" : "scheduled", operationalStatus: perStage ? (["scheduled","waiting","in_consultation","completed"] as const)[i%4] : (["scheduled","waiting","in_consultation"] as const)[i%3], visitType: "new", intakeStatus: "not_started", intakeLastSentAt:null,intakeAccessStatus:"not_sent",intakeAccessExpiresAt:null,
  documentStatus:"needs_review",documentCount:1,isPriority:false,priorityUpdatedByName:null,priorityUpdatedByRole:null,priorityUpdatedAt:null,priorityReason:null
 }));
 const queue: AppointmentQueue = { items, summary: {total,scheduled:items.filter(i=>i.operationalStatus==="scheduled").length,arrived:0,waiting:items.filter(i=>i.operationalStatus==="waiting").length,inConsultation:items.filter(i=>i.operationalStatus==="in_consultation").length,intakePending:total,processing:0,needsReview:total,priority:0,completed:items.filter(i=>i.operationalStatus==="completed").length,needsAction:items.filter(i=>i.appointmentStatus==="scheduled").length} };
 return <AppShell doctorName="Synthetic responsive fixture" clinicName="Synthetic viewport fixture clinic" patientCount={total} role="doctor" workspace={doctor?"clinical":"desk"}>
  <div className={styles.pageContent}><p role="status">Local synthetic component fixture · {total} items · no fixture actions should be submitted.</p>
   <div className={styles.overviewHeader}><div><p className={styles.eyebrow}>{doctor?"Doctor workspace":"Clinic Desk"}</p><h1>{doctor?"Good evening, Synthetic":"Today"}</h1><p>Fictional layout stress fixture of the actual components.</p></div></div>
   <div className={styles.doctorKpiGrid} aria-label="Today summary">{["Visits today","Waiting now","Human-marked priority","Needs action"].map((label,i)=><div className={styles.statCard} key={label}><div><strong>{[queue.summary.total,queue.summary.waiting,queue.summary.priority,queue.summary.needsAction][i]}</strong><small>{label}</small></div></div>)}</div>
   {doctor?<DoctorTodayList items={items}/>:<ClinicDeskToday queue={queue}/>}</div></AppShell>;
}
