/**
 * Scrolls to and focuses the first form field with a validation error.
 * Call this as the `onInvalid` callback of `form.handleSubmit(onValid, onInvalid)`.
 *
 * Waits one animation frame for react-hook-form to update `aria-invalid` attributes.
 */
export function scrollToFirstError(): void {
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.focus();
    }
  });
}
