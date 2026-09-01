/**
 * Lightweight analytics event emitter.
 * Logs to console in development; swap the `send` function
 * for PostHog/Mixpanel/Amplitude in production.
 */

interface EventProperties {
  [key: string]: string | number | boolean | undefined;
}

function send(name: string, properties: EventProperties): void {
  if (import.meta.env.DEV) {
    console.debug('[analytics]', name, properties);
  }
  // Production: replace with posthog.capture(name, properties)
}

export function trackEvent(name: string, properties: EventProperties = {}): void {
  send(name, {
    ...properties,
    timestamp: Date.now(),
    path: window.location.pathname,
  });
}

export function trackPageView(path: string): void {
  trackEvent('page_view', { path });
}

export function trackFlowStep(
  flowName: string,
  stepIndex: number,
  stepLabel: string,
): void {
  trackEvent('flow_step', { flow: flowName, step: stepIndex, label: stepLabel });
}

export function trackFlowComplete(flowName: string, durationMs: number): void {
  trackEvent('flow_complete', { flow: flowName, duration_ms: durationMs });
}

export function trackFlowAbandon(
  flowName: string,
  lastStep: number,
  lastStepLabel: string,
): void {
  trackEvent('flow_abandon', {
    flow: flowName,
    last_step: lastStep,
    last_label: lastStepLabel,
  });
}

export function trackError(
  errorType: string,
  message: string,
  context?: string,
): void {
  trackEvent('error_surface', { error_type: errorType, message, context });
}
