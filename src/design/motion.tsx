import { useEffect, type PropsWithChildren } from 'react';
import { LazyMotion, MotionConfig, m, useAnimationControls, useReducedMotion } from 'motion/react';

import { motionTokens } from './motion-tokens';
const loadFeatures = () => import('./motion-features').then((module) => module.default);

export function VexoraMotionProvider({ children }: PropsWithChildren) {
  return (
    <MotionConfig
      reducedMotion="user"
      transition={{ duration: motionTokens.component, ease: motionTokens.ease }}
    >
      <LazyMotion features={loadFeatures} strict>
        {children}
      </LazyMotion>
    </MotionConfig>
  );
}

/** The container stays mounted: route motion never resets forms, providers or the assistant. */
export function VexoraPageTransition({
  identity,
  children,
  className = '',
}: PropsWithChildren<{ identity: string; className?: string }>) {
  const controls = useAnimationControls();
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) {
      controls.set({ opacity: 1, y: 0 });
      return;
    }
    controls.set({ opacity: 0.6, y: 8 });
    void controls.start({
      opacity: 1,
      y: 0,
      transition: { duration: motionTokens.component, ease: motionTokens.ease },
    });
    return () => controls.stop();
  }, [identity, reduced, controls]);
  return (
    <m.div className={`page-content ${className}`} animate={controls}>
      {children}
    </m.div>
  );
}

/** Only freshly mounted content; never key this to polling responses. */
export function VexoraReveal({
  children,
  className = '',
  delay = 0,
}: PropsWithChildren<{ className?: string; delay?: number }>) {
  const reduced = useReducedMotion();
  return (
    <m.div
      className={className}
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: reduced ? 0 : motionTokens.component,
        delay: reduced ? 0 : delay,
        ease: motionTokens.ease,
      }}
    >
      {children}
    </m.div>
  );
}
