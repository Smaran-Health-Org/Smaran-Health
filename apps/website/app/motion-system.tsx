"use client";

import { useEffect } from "react";

export function MotionSystem() {
  useEffect(() => {
    const root = document.documentElement;
    const workflowOrbit = document.querySelector<HTMLElement>(
      "[data-workflow-orbit]",
    );
    const orbitCards = workflowOrbit
      ? Array.from(
          workflowOrbit.querySelectorAll<HTMLElement>("[data-orbit-card]"),
        )
      : [];
    let frame = 0;

    const setScrollProgress = () => {
      frame = 0;
      const max = Math.max(
        document.body.scrollHeight - window.innerHeight,
        1,
      );
      root.style.setProperty("--scroll-progress", `${window.scrollY / max}`);

      if (workflowOrbit && orbitCards.length > 0) {
        const rect = workflowOrbit.getBoundingClientRect();
        const travel = Math.max(rect.height - window.innerHeight * 0.28, 1);
        const raw = (window.innerHeight * 0.72 - rect.top) / travel;
        const progress = Math.min(Math.max(raw, 0), 1);
        const stageWidth = Math.min(window.innerWidth, rect.width);
        const radiusX = Math.min(
          Math.max(stageWidth * 0.41, 280),
          Math.max((stageWidth - 430) / 2, 260),
        );
        const radiusY = Math.min(Math.max(window.innerHeight * 0.32, 210), 330);
        const spin = progress * Math.PI * 1.32;

        workflowOrbit.style.setProperty(
          "--workflow-progress",
          progress.toFixed(4),
        );
        workflowOrbit.style.setProperty(
          "--workflow-primary-opacity",
          `${Math.max(1 - progress * 2.35, 0).toFixed(4)}`,
        );
        workflowOrbit.style.setProperty(
          "--workflow-secondary-opacity",
          `${Math.min(Math.max((progress - 0.28) * 2.4, 0), 1).toFixed(4)}`,
        );

        orbitCards.forEach((card, index) => {
          const baseAngles = [-2.36, 2.36, 0.78, -0.78];
          const angle = baseAngles[index] + spin;
          const x = Math.cos(angle) * radiusX;
          const y = Math.sin(angle) * radiusY;
          const depth = (Math.sin(angle) + 1) / 2;
          const scale = 0.9 + depth * 0.12;
          const rotation = Math.sin(angle) * 2.6;

          card.style.setProperty("--orbit-x", `${x.toFixed(1)}px`);
          card.style.setProperty("--orbit-y", `${y.toFixed(1)}px`);
          card.style.setProperty("--orbit-scale", scale.toFixed(3));
          card.style.setProperty(
            "--orbit-rotation",
            `${rotation.toFixed(2)}deg`,
          );
          card.style.setProperty("--orbit-opacity", `${0.78 + depth * 0.22}`);
          card.style.zIndex = String(8 + Math.round(depth * 10));
        });
      }
    };

    const onScroll = () => {
      if (frame) {
        return;
      }

      frame = window.requestAnimationFrame(setScrollProgress);
    };

    const onPointerMove = (event: PointerEvent) => {
      const x = event.clientX / Math.max(window.innerWidth, 1) - 0.5;
      const y = event.clientY / Math.max(window.innerHeight, 1) - 0.5;
      root.style.setProperty("--pointer-x", x.toFixed(3));
      root.style.setProperty("--pointer-y", y.toFixed(3));
    };

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.16 },
    );

    document.querySelectorAll("[data-reveal]").forEach((element) => {
      observer.observe(element);
    });

    root.dataset.motion = "ready";
    setScrollProgress();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", setScrollProgress);
    window.addEventListener("pointermove", onPointerMove, { passive: true });

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", setScrollProgress);
      window.removeEventListener("pointermove", onPointerMove);
      observer.disconnect();
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, []);

  return null;
}
