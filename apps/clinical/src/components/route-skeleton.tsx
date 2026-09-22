import styles from "@/components/clinical.module.css";

/**
 * Shared route-level loading surface.
 *
 * Next.js swaps this in the moment a navigation starts, while the destination
 * Server Component resolves its session and clinic-scoped queries. Two reasons
 * it mirrors the app shell:
 *
 * 1. the shell is rendered by each page rather than a layout, so a bare spinner
 *    would flash the sidebar and content area in and out;
 * 2. a `loading.tsx` boundary is what lets Next.js prefetch a dynamic route, so
 *    the transition becomes an instant shell swap instead of a blank wait.
 */
export function RouteLoading({ label = "Loading" }: { label?: string }) {
  return (
    <div className={styles.shell} aria-busy="true">
      <aside className={styles.sidebar} aria-hidden="true">
        <div className={styles.skeletonBrand}>
          <span className={styles.skeletonBrandMark} />
          <span className={styles.skeletonBrandText} />
        </div>
        <div className={styles.skeletonClinic} />
        <div className={styles.skeletonNav}>
          <span className={styles.skeletonNavItem} />
          <span className={styles.skeletonNavItem} />
          <span className={styles.skeletonNavItem} />
        </div>
      </aside>
      <div className={styles.appSurface}>
        <div className={styles.accountBar}>
          <span className={styles.skeletonAccount} />
        </div>
        <div className={styles.pageContent}>
          <p className={styles.routeLoadingStatus} role="status">
            <span className={styles.loadingSpinner} aria-hidden="true" />
            {label}…
          </p>
          <div className={styles.skeletonHeader} />
          <div className={styles.skeletonGrid}>
            <span className={styles.skeletonCard} />
            <span className={styles.skeletonCard} />
            <span className={styles.skeletonCard} />
            <span className={styles.skeletonCard} />
          </div>
          <div className={styles.skeletonPanel} />
        </div>
      </div>
    </div>
  );
}
