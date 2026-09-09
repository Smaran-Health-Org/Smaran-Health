-- Batch transitions use the same protected clinical authority as Phase 8.
-- Preserve its narrow, non-PHI audit trail for each batch-created disposition.

CREATE FUNCTION public.audit_phase10_batch_delta_disposition()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_delta public.clinical_state_deltas%ROWTYPE;
BEGIN
  IF NEW.actor_id IS NULL OR NEW.idempotency_key NOT LIKE 'batch:%' THEN RETURN NEW; END IF;
  SELECT * INTO v_delta FROM public.clinical_state_deltas WHERE id = NEW.delta_id;
  IF NEW.disposition = 'accepted' THEN
    INSERT INTO public.audit_logs (clinic_id, actor_id, action, resource_type, resource_id, metadata)
    VALUES (NEW.clinic_id, NEW.actor_id, 'delta_accepted', 'clinical_state_delta', NEW.delta_id,
      jsonb_build_object('domain', v_delta.domain::text, 'state_version_id', NEW.resulting_state_version_id, 'batch_receipt', true)),
      (NEW.clinic_id, NEW.actor_id, 'clinical_state_changed', 'confirmed_clinical_state_version', NEW.resulting_state_version_id,
      jsonb_build_object('domain', v_delta.domain::text, 'source_delta_id', NEW.delta_id, 'batch_receipt', true));
  ELSIF NEW.disposition = 'kept_current' THEN
    INSERT INTO public.audit_logs (clinic_id, actor_id, action, resource_type, resource_id, metadata)
    VALUES (NEW.clinic_id, NEW.actor_id, 'delta_ignored', 'clinical_state_delta', NEW.delta_id,
      jsonb_build_object('domain', v_delta.domain::text, 'batch_receipt', true));
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER clinical_state_delta_dispositions_phase10_batch_audit
  AFTER INSERT ON public.clinical_state_delta_dispositions
  FOR EACH ROW EXECUTE FUNCTION public.audit_phase10_batch_delta_disposition();
REVOKE ALL ON FUNCTION public.audit_phase10_batch_delta_disposition() FROM PUBLIC, anon, authenticated;
