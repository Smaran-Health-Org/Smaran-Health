# UAT Feedback — 2026-09-22

Testing team feedback for Smaran Health (45 points). Source: pasted UAT feedback document.

---

1. Scheduler — Appointment Details Panel

Current behaviour

When an existing appointment is clicked in the scheduler, the appointment details panel opens on the right-hand side.

The panel currently displays useful information such as:

* Appointment time
* Date
* Duration
* Doctor
* Visit type
* Appointment lifecycle / arrival state
* Intake status
* Document status
* Available appointment actions

Feedback / Changes Required

* The panel currently shows a "Start Visit / Start Consultation" action even when the user is logged into the Reception workspace.
* This does not currently make sense for a receptionist because starting the medical consultation should primarily be a doctor action.
* This is still debatable and should be discussed from a workflow/permission perspective.

The appointment details should also clearly show how the appointment originated, for example:

* Walk-in
* Follow-up appointment
* Online booking
* Reception-created appointment
* Other future booking channels

Currently this source/context is not visible.

Lifecycle / Preparation

The lifecycle section showing the patient's arrival state is useful.

The preparation section is also useful, for example:

* Intake pending
* No documents received
* Documents available

This section feels appropriately informative rather than action-heavy and should remain.

---

2. Scheduler — Appointment Actions Not Working

The appointment details panel contains actions such as:

* Send Patient Link
* Reschedule
* Reassign Doctor
* Cancel Appointment
* Mark No-show

Currently none of these actions appear to work.

Each action needs to be checked end-to-end, including:

* UI interaction
* API/backend operation
* Database update
* Scheduler refresh
* Relevant audit/status updates
* Success confirmation
* Error handling

---

3. Walk-in Patient Booking

Major Scheduling Conflict Issue

When adding a walk-in patient, the system currently appears to add the patient at the current/default time.

This happens even when:

* Another patient already has an appointment at that time.
* A scheduled booking already exists.
* The doctor is unavailable.
* A leave block exists.
* The time slot has otherwise been blocked.

This creates overlapping appointments and can result in two patients having the same appointment time unintentionally.

Required change

When creating a walk-in patient, the receptionist should have an explicit appointment time / slot selector.

The flow should therefore include something like:

Add Walk-in → Patient Details → Doctor → Appointment Time → Confirm

The scheduler should check availability before completing the booking.

---

4. Booking Into Blocked / Leave Time

I tested placing a leave blocker on the doctor's schedule and then adding a walk-in patient during the same blocked period.

The application still allowed the patient to be added.

This should not happen silently.

Expected behaviour

If someone attempts to book during:

* Doctor leave
* Blocked time
* Unavailable time
* Other scheduling exception

the system should clearly warn:

This time is currently blocked / the doctor is unavailable.

The receptionist/admin should then have the option to intentionally override the block, if permissions allow.

The system should therefore support:

Availability validation → Warning → Explicit override → Booking

rather than automatically allowing the booking.

---

5. Reception Workspace

The Reception workspace currently contains sections such as:

* Expected
* Waiting
* With Doctor
* Completed

This overall structure makes sense.

Patient Cards

Each patient card needs more operational information.

It should clearly display:

* Appointment time
* Patient name
* New / existing patient
* Waiting duration
* Check-in time
* Priority status
* Intake status where relevant

Waiting information

The current patient card displays waiting-related information, but the meaning is not always clear.

We should distinguish between:

* Checked in at: actual time the patient arrived
* Waiting for: elapsed waiting duration

For example:

Checked in: 10:12 AM
Waiting: 18 min

The meaning of the existing number shown on patient blocks needs to be reviewed and clarified.

---

6. Priority Patients

If a receptionist/admin marks a patient as priority, the patient should move to the top of the waiting queue.

The receptionist/admin should also be able to change the patient's appointment timing when necessary.

Priority handling should therefore affect the operational queue, not just display a visual flag.

---

7. Send Patient Link — Reception

The Send Link action should eventually send the patient intake link through:

* Email
* WhatsApp

Currently the action is failing on the deployed website.

The application displays an error similar to:

Intake email could not be sent. Check email delivery setup.

However, on the local environment, sending the same intake email is working.

Investigation required

Compare:

* Local environment variables
* Deployment environment variables
* Email provider configuration
* API routes
* Domain/provider permissions
* Resend configuration
* Production deployment configuration

Missing UX feedback

Even when email sending works locally, the interface does not clearly confirm success.

After sending the link, the user should receive visible confirmation such as:

Patient intake link sent successfully.

Ideally the system should also display:

* Channel used
* Time sent
* Delivery state where available

Example:

Email sent • 10:34 AM

---

8. Patient Intake / Pre-consultation Form

Basic Details

The current form asks for:

* Full name
* Date of birth
* Gender

We should research comparable healthcare/patient intake applications to determine which additional fields should be collected.

One possible additional field is:

* Weight

Other clinically useful intake fields should be evaluated before adding them so the form does not become unnecessarily long.

---

9. Patient Medical Information

The current intake form includes:

* Reason for visit
* Existing conditions
* Current medicines
* Allergies

These fields are useful and should remain.

---

10. Document Upload Bug

The documents section correctly states that uploading documents is optional.

However, if the patient tries to submit the form without uploading a PDF/file, the system gives an error asking the user to:

Choose a file.

This contradicts the optional state.

Expected behaviour

A patient who has no medical documents should still be able to submit the form successfully.

Document upload must truly be optional.

---

11. Duplicate Document Upload Step

After uploading a document and submitting the intake form, the application correctly displays a confirmation that the form has been submitted.

However, the patient is then shown another Medical Documents section asking them to upload documents again.

This is incorrect because document upload already exists within the intake form.

Required change

The second document upload screen should be removed.

The flow should ideally be:

Patient Details → Medical Details → Documents (optional) → Submit → Confirmation

---

12. Appointment Booking After Intake

After completing the patient intake form, there should also be an option for the patient to book an appointment, where appropriate.

The scheduler development reportedly already includes this capability, but the booking option is not appearing in the current patient flow.

This needs investigation to determine whether:

* The feature is not connected.
* The route is incorrect.
* The component is hidden.
* Deployment is behind local development.
* Patient booking and scheduler flows are not yet integrated.

---

13. Reception / Operational Patient View

The receptionist can open an operational patient view and add/review patient details.

The page is functionally good overall.

However:

* Font usage is inconsistent.
* General UI consistency needs improvement.
* The page could look significantly cleaner.
* Information architecture should be reviewed.

Because this page displays much of the same patient information captured in the patient intake form, any changes made to intake fields should also propagate here.

The intake form and operational patient view should use the same underlying patient data model rather than becoming two independent experiences.

---

14. Scheduler Settings

The Scheduler Settings page contains functionality such as:

* Doctor schedules
* Doctor name
* Interval
* Duration
* Weekly working hours
* Availability exceptions
* Leave
* Special working hours
* Appointment types

Overall, this gives doctors/admins substantial control over scheduling.

The functionality itself appears useful.

---

15. Scheduler Settings — Naming Problems

The biggest usability problem is the naming convention.

Several labels are difficult to understand on first read.

Examples include:

* Interval
* Duration
* Other current scheduling terminology

It is not immediately obvious what changing these values will do.

For example:

Does Interval mean:

* Appointment slot interval?
* Calendar grid interval?
* Booking interval?
* Minimum time between appointments?

Does Duration mean:

* Default appointment duration?
* Working-session duration?
* Appointment-type duration?

These names need proper discussion and user-oriented terminology.

The user should understand each setting without requiring documentation.

---

16. Scheduler Settings — Edit / Action Button

The action/edit control within the doctor schedule configuration is visually too long and does not clearly feel like an interactive button.

It needs stronger button affordance.

Consider:

* More compact dimensions
* Better hierarchy
* Clear button styling
* Appropriate colour/background treatment

---

17. Weekly Working Hours

The weekly working hours functionality makes sense.

Doctors/admins should be able to define:

* Working days
* Start time
* End time
* Booking availability

This appears to be a useful part of scheduler configuration.

---

18. Availability Exceptions

Availability exceptions are also useful.

They should allow configuration for:

* Leave
* Temporary absence
* Blocked periods
* Special working hours
* One-off schedule changes

The underlying feature appears useful, but the naming and workflow should become easier to understand.

---

19. Appointment Types

Appointment types need to be properly added/configured.

Potential appointment types may eventually include:

* New consultation
* Follow-up
* Procedure
* Teleconsultation
* Review
* Other specialty-specific appointment types

Appointment types should ideally allow different durations and possibly different availability rules.

---

20. Workspace Switching — Reception vs Doctor

Switching between Reception and Doctor workspaces currently requires too many interactions.

The current experience appears to be:

Click doctor/profile/navigation element → open dialog → choose workspace/doctor

This should be simplified.

Suggested UI

Add a small workspace switcher near the top-right corner, close to the profile icon.

For example:

Reception | Doctor

or a compact toggle/dropdown.

Selecting:

* Doctor → opens Doctor workspace
* Reception → opens Reception workspace

The switch should be immediately visible and fast to use.

---

21. Doctor Workspace — Dashboard

The Doctor dashboard overall looks good.

It includes:

* KPIs
* Priority/flag indicators
* Patient sequence
* Review Patient action

The general concept is useful.

---

22. Pre-consultation Brief — Visual Design

When the doctor selects Review Patient, the pre-consultation brief opens.

The page currently contains blocks representing information such as:

* Why the patient is here today
* Patient-provided information
* Available evidence
* Preparation status
* Other clinical/pre-visit information

The current layout feels cluttered because many cards/blocks are visually touching each other.

Required improvement

Improve:

* Spacing
* Card hierarchy
* Section separation
* Typography
* Information prioritisation

The doctor should be able to scan the page extremely quickly.

---

23. Pre-consultation Brief — Data Sources

The purpose of this page should be to aggregate information from:

Patient-provided information

From the intake link:

* Reason for visit
* Conditions
* Allergies
* Medicines
* Other relevant intake details

Reception-provided information

Information captured during check-in or clinic intake.

Uploaded documents

Information extracted from:

* Blood reports
* Lab reports
* Prescriptions
* Other medical reports/documents

This should become the doctor's single pre-consultation summary.

---

24. Data Working Locally but Not on Website

In the local environment, patient intake information appears correctly in the doctor's pre-consultation brief.

Example tested data included:

* Fever as reason for visit
* Asthma as existing condition
* Allergy information
* No current medicines

This appears to work locally.

The deployed website is not currently showing equivalent data because the email/patient-link workflow is failing.

The deployment issue therefore affects downstream testing of the doctor workflow as well.

---

25. Pre-consultation Brief — Document Extraction

Currently the page does not appear to meaningfully extract information from uploaded documents.

Eventually it should extract relevant clinical information such as:

* Lab values
* Abnormal results
* Trends
* Previous diagnosis information
* Medications from prescriptions
* Other clinically relevant report data

This is a core part of the desired experience.

---

26. Pre-consultation Information Architecture

For another tested patient, reception-added data included information such as:

* Blood pressure
* Sugar readings
* Other patient observations/details

Although the information itself is useful, the way the page is currently designed is confusing.

A doctor may struggle to immediately understand:

* What information came from the patient
* What came from reception
* What came from documents
* What has been extracted by AI
* What information is verified vs unverified

The hierarchy and presentation therefore need further design work.

---

27. Evidence Links — Current Problem

Currently several pieces of information contain an evidence link.

Clicking the evidence link opens another page.

There are two major issues.

Navigation problem

There is no clear way to return to the patient/pre-consultation page.

The doctor must manually navigate backwards and reopen the patient.

A clear:

* Back button
* Breadcrumb
* Drawer/modal
* Side panel

should be provided.

Too many evidence links

The application appears to show evidence links for almost every piece of information.

For example:

* Medical history
* Allergies
* Reception-entered information
* Patient-entered information

This feels unnecessary and creates visual noise.

---

28. Better Evidence Model

Evidence is much more useful when information has been extracted from an original clinical document.

For example:

AI extracts:

HbA1c: 8.2%

The doctor should then be able to click something such as:

View source

and immediately see the original lab report and relevant location/context.

This is important because AI extraction may be imperfect and doctors need to verify important extracted information.

Evidence should therefore primarily support:

* Lab report extraction
* Prescription extraction
* Imaging/report extraction
* Medical document extraction
* Other AI-derived information

---

29. Evidence for Patient-entered Information

For information directly entered by the patient, such as:

* Allergies
* Past conditions
* Symptoms
* Current medications

the doctor generally does not need an individual evidence link beside every field.

The source can simply be indicated as:

Patient reported

Similarly:

Reception reported

could identify reception-entered information.

This would reduce unnecessary links and improve readability.

---

30. Evidence Navigation

Instead of opening a completely separate page for every evidence item, consider:

* Side drawer
* Modal
* Expandable source panel
* Embedded report viewer

The doctor should be able to check the original report without losing context from the pre-consultation brief.

---

31. Duplicate Patient Profile Step Before Consultation

After reviewing the pre-consultation brief, proceeding further currently sends the doctor to a patient profile page.

This does not make sense in the consultation flow.

The doctor has already reviewed the relevant patient information in the pre-consultation brief.

Showing another patient-details/profile screen adds duplication and friction.

Suggested flow

Instead of:

Pre-consultation Brief → Patient Profile → Consent → Recording

prefer:

Pre-consultation Brief → Start Consultation

The patient profile can remain accessible separately when the doctor intentionally wants historical information.

---

32. Patient Profile Placement

If some patient profile/history information is important during consultation, it can be incorporated into the pre-consultation experience.

Possible placement:

* Lower section of the pre-consultation brief
* Right-side panel
* Expandable patient history
* Dedicated optional "Patient History" view

It should not be a mandatory intermediate page.

---

33. Consent Flow

The current consultation flow contains a separate consent page.

This creates additional friction and may not be necessary if consent has already been collected earlier.

Suggested consent model

Consent could be collected during:

Digital patient intake

When the patient opens the intake link:

* Show required consent.
* Patient explicitly accepts it.

Walk-in flow

Receptionist captures consent while checking in / onboarding the patient.

This could then be stored against the visit.

Desired result

By the time the patient reaches the doctor, required consent should already be complete.

The doctor should therefore not need to interrupt the consultation workflow with another consent screen unless consent is missing or invalid.

---

34. Doctor Consultation Recording — Major Issue

The consultation recording/transcription workflow is currently not working reliably enough.

The system appears to:

* Capture only fragments of the conversation.
* Miss portions of speech.
* Fail to understand the full consultation context.

The exact cause is currently unknown.

Possible areas to investigate include:

* Audio capture
* Browser recording
* Audio chunking
* Upload reliability
* Network handling
* Server processing
* Speech-to-text configuration
* Session interruptions
* Streaming/chunk ordering
* Language handling
* Silence/noise handling

---

35. Recording Reliability Is MVP-Critical

This is one of the most important issues identified during testing.

Recording → transcription → clinical understanding is a core part of the Smaran MVP.

Doctors may operate in environments with:

* Variable internet quality
* Background noise
* Low-volume speech
* Multiple speakers
* Regional languages
* Interruptions

The system therefore needs significant testing under realistic clinic conditions.

It cannot depend on ideal Wi-Fi or a silent environment.

---

36. Demo / Product Reliability Risk

If consultation capture fails during a live demonstration or doctor pilot, it could severely damage confidence in the product.

This area should therefore receive high priority before external demos/pilots.

Testing should include:

* Long consultations
* Slow internet
* Temporary network drop
* Background clinic noise
* Multiple speakers
* Quiet speakers
* Different microphone quality
* Regional language conversations
* Code-switching between English and Indian languages
* Browser/device differences

---

37. Prescription Drafting

Once recording/transcription information is successfully captured, the prescription drafting functionality appears to work well.

The system is able to organise captured information into blocks such as:

* Chief complaint
* Medication
* Medication changes
* Other consultation information

This is a positive part of the current workflow.

The primary problem therefore appears to be the quality/completeness of the captured consultation data, rather than only the downstream structuring step.

---

38. "Next Patient" Navigation

After:

* Consultation completion
* Prescription creation
* Doctor approval

the doctor clicks Next Patient.

Currently the application sends the doctor to the general Patients page.

This is not the desired workflow.

Expected behaviour

The doctor should return to the Today's Queue / Doctor workspace patient list.

The flow should be:

Complete patient → Next Patient → Today's Queue → Review next patient → Start consultation

This allows continuous clinic operation without unnecessary navigation.

---

39. Reception Workspace — Completed Patient State

After the doctor finishes the consultation, the patient correctly moves into the Completed section in the Reception/Admin workspace.

However, when the receptionist opens the completed patient card, the operational patient view shows:

No visit today

This is incorrect.

The system should clearly recognise that a visit occurred today.

---

40. Completed Patient Details

For a completed consultation, the receptionist/admin should ideally see relevant visit status/details such as:

* Visit completed
* Doctor
* Appointment time
* Check-in time
* Consultation completion time
* Prescription generated
* Follow-up information
* Relevant operational status

The receptionist may not need access to every clinical detail depending on permissions, but the operational record should accurately reflect that the visit occurred.

---

41. Cross-workspace State Synchronisation

The completed-patient issue suggests that visit state may not be synchronising correctly between:

* Scheduler
* Doctor workspace
* Reception workspace
* Patient record
* Encounter/consultation record

This should be reviewed end-to-end.

A patient's lifecycle should remain consistent across all surfaces:

Scheduled → Expected → Arrived → Waiting → With Doctor → Consultation Complete → Completed

All workspaces should derive state from the same canonical visit/encounter information.

---

42. Overall Desired Clinic Workflow

Based on the testing feedback, the intended end-to-end experience should approximately be:

Appointment creation

Book appointment / Add walk-in → Select doctor → Select valid time → Confirm

Before visit

Send intake link → Patient fills details → Uploads documents if available → Gives consent

Arrival

Reception checks patient in → Adds operational details → Patient enters waiting queue

Doctor preparation

Doctor selects patient → Reviews one unified pre-consultation brief

The brief combines:

* Patient intake
* Reception information
* Previous history
* Uploaded documents
* AI-extracted report information

Consultation

Start consultation → Record/transcribe → Generate structured clinical draft

Completion

Doctor reviews → Approves prescription/summary → Completes visit

Queue continuation

Next Patient → Today's Queue

Reception

Patient automatically moves to Completed, with the visit accurately reflected.

---

43. Major Product Principles Emerging From Testing

Several broader principles are emerging from this UAT.

A. Reception and Doctor actions must remain role-aware

Reception should primarily manage:

* Scheduling
* Intake
* Check-in
* Queue
* Operational status

Doctors should primarily manage:

* Clinical review
* Consultation
* Prescription
* Clinical completion

B. Avoid duplicate information/screens

The doctor should not repeatedly see:

* Pre-consultation
* Patient profile
* Consent
* Similar patient details

before finally starting the consultation.

C. One pre-consultation brief should become the doctor's preparation screen

It should aggregate everything required before the consultation.

D. Evidence should be contextual

Evidence is valuable primarily for verifying document-derived/AI-extracted information rather than cluttering every patient-entered field.

E. Scheduler availability must be authoritative

Walk-ins and manual bookings should never silently bypass:

* Existing appointments
* Leave
* Blocks
* Availability rules

Overrides can exist, but they must be deliberate.

F. Clinic workflow should optimise for speed

During a busy OPD, common flows need to require very few clicks.

Examples:

* Workspace switching
* Next patient
* Walk-in booking
* Sending intake links
* Reviewing patient preparation

G. Consultation recording reliability is an MVP-critical requirement

The rest of the AI workflow depends on the quality and completeness of captured consultation audio/transcription.

---

44. High-Priority Bugs Identified During This UAT

The following issues appear to be functional bugs rather than only UX improvements:

1. Appointment action buttons are not working.
2. Walk-ins can be booked over an existing appointment.
3. Walk-ins can be booked during doctor leave/blocked time.
4. Walk-in flow does not provide proper appointment-time selection.
5. Send Patient Link fails on the deployed website.
6. Successful email sending locally does not provide clear confirmation.
7. Optional document upload behaves as mandatory.
8. Medical document upload is unnecessarily shown again after intake submission.
9. Patient appointment booking option is missing after intake despite scheduler functionality existing.
10. Patient intake information works locally but is not flowing through the deployed environment.
11. Evidence navigation has no convenient return path.
12. Consultation recording/transcription captures incomplete conversation.
13. Next Patient redirects to Patients instead of Today's Queue.
14. Completed patients show "No visit today."
15. Visit state appears inconsistent between Scheduler, Reception and Doctor workspaces.

---

45. UX / Product Improvements Requiring Discussion

These are not necessarily bugs and require product/design decisions:

* Whether Reception should ever see Start Consultation.
* What appointment-origin/source information should be displayed.
* Additional patient intake fields.
* Scheduler setting terminology.
* Appointment type configuration.
* Workspace switcher design.
* Pre-consultation information architecture.
* Which information requires evidence links.
* Whether evidence opens in a drawer/modal/report viewer.
* Removal/repositioning of the patient profile step.
* Moving consent completely into intake/check-in.
* Reception permissions for viewing post-consultation information.
* Exact behaviour of priority patients and queue reordering.
