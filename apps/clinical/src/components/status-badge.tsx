import styles from "@/components/clinical.module.css";
import {
  consultationStatusLabel,
  consultationStatusTone,
} from "@/lib/status";

export function StatusBadge({
  status,
}: {
  status: string | null | undefined;
}) {
  const tone = consultationStatusTone(status);
  return (
    <span className={styles.statusBadge} data-tone={tone}>
      {consultationStatusLabel(status)}
    </span>
  );
}
